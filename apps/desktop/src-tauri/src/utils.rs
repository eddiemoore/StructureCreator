//! Utility functions and constants.

use std::io::Read;

// ============================================================================
// Constants
// ============================================================================

/// Maximum file size for URL imports (5 MB)
pub const MAX_IMPORT_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// Maximum allowed length for template names
pub const MAX_TEMPLATE_NAME_LENGTH: usize = 100;

/// Maximum allowed length for regex patterns to prevent DoS via complex patterns
pub const MAX_REGEX_PATTERN_LENGTH: usize = 1000;

// ============================================================================
// Template Name Validation
// ============================================================================

/// Validate a template name for import
pub fn validate_template_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("Template name cannot be empty".to_string());
    }

    if trimmed.len() > MAX_TEMPLATE_NAME_LENGTH {
        return Err(format!(
            "Template name cannot exceed {} characters (got {})",
            MAX_TEMPLATE_NAME_LENGTH,
            trimmed.len()
        ));
    }

    // Check for control characters
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Template name cannot contain control characters".to_string());
    }

    Ok(trimmed.to_string())
}

// ============================================================================
// Version Validation
// ============================================================================

/// Regex pattern for valid version strings: 1.x or 1.x.y where x,y are digits
pub fn is_valid_version(version: &str) -> bool {
    // Must start with "1." followed by one or more digits, optionally followed by ".digits"
    let bytes = version.as_bytes();
    if bytes.len() < 3 || bytes[0] != b'1' || bytes[1] != b'.' {
        return false;
    }

    let rest = &version[2..];
    let mut has_digit = false;
    let mut seen_dot = false;

    for (i, c) in rest.chars().enumerate() {
        match c {
            '0'..='9' => {
                has_digit = true;
            }
            '.' => {
                if i == 0 || seen_dot {
                    return false; // Leading dot or multiple dots
                }
                seen_dot = true;
                has_digit = false; // Reset for next segment
            }
            _ => return false, // Invalid character
        }
    }

    has_digit // Must end with a digit
}

// ============================================================================
// SSRF Protection
// ============================================================================

/// Check if an IPv4 address is private/internal
fn is_private_ipv4(ipv4: &std::net::Ipv4Addr) -> bool {
    ipv4.is_loopback()           // 127.0.0.0/8
        || ipv4.is_private()     // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        || ipv4.is_link_local()  // 169.254.0.0/16 (includes cloud metadata 169.254.169.254)
        || ipv4.is_broadcast()   // 255.255.255.255
        || ipv4.is_unspecified() // 0.0.0.0
}

/// URL validation for import to prevent SSRF attacks
pub fn validate_import_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url)
        .map_err(|e| format!("Invalid URL: {}", e))?;

    // Only allow HTTPS - provides protection against DNS rebinding via certificate validation
    // and prevents MITM attacks on template downloads
    match parsed.scheme() {
        "https" => {}
        "http" => return Err("HTTP is not allowed for security reasons. Please use HTTPS.".to_string()),
        scheme => return Err(format!("URL scheme '{}' is not allowed. Use HTTPS.", scheme)),
    }

    // Block access to private/internal networks
    match parsed.host() {
        Some(url::Host::Domain(domain)) => {
            let domain_lower = domain.to_lowercase();

            // Block localhost
            if domain_lower == "localhost" {
                return Err("Access to localhost is not allowed".to_string());
            }

            // Block common internal hostnames
            if domain_lower == "internal" || domain_lower.ends_with(".local") || domain_lower.ends_with(".internal") {
                return Err("Access to internal network hosts is not allowed".to_string());
            }
        }
        Some(url::Host::Ipv4(ipv4)) => {
            if is_private_ipv4(&ipv4) {
                return Err(format!("Access to private/internal IP address '{}' is not allowed", ipv4));
            }
        }
        Some(url::Host::Ipv6(ipv6)) => {
            let segments = ipv6.segments();
            let is_loopback = ipv6.is_loopback();           // ::1
            let is_unspecified = ipv6.is_unspecified();     // ::
            let is_unique_local = (segments[0] & 0xfe00) == 0xfc00;  // fc00::/7
            let is_link_local = (segments[0] & 0xffc0) == 0xfe80;    // fe80::/10

            // Check for IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
            // These could bypass IPv4 private range checks
            let is_ipv4_mapped = segments[0..5].iter().all(|&s| s == 0) && segments[5] == 0xffff;
            if is_ipv4_mapped {
                let ipv4 = std::net::Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                if is_private_ipv4(&ipv4) {
                    return Err(format!("Access to private/internal IP address '{}' is not allowed", ipv6));
                }
            }

            if is_loopback || is_unspecified || is_unique_local || is_link_local {
                return Err(format!("Access to private/internal IP address '{}' is not allowed", ipv6));
            }
        }
        None => {
            return Err("URL must have a valid host".to_string());
        }
    }

    Ok(())
}

// ============================================================================
// Download Helpers
// ============================================================================

/// Download a file from URL with size limit for template imports
pub fn download_file_with_limit(url: &str, max_size: u64) -> Result<String, String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("HTTP error {}", code),
            ureq::Error::Transport(t) => format!("Network error: {}", t),
        })?;

    // Check Content-Length if available
    if let Some(content_length) = response.header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok())
    {
        if content_length > max_size {
            return Err(format!(
                "File too large: {} bytes (max {} bytes)",
                content_length, max_size
            ));
        }
    }

    // Read with size limit
    let mut body = String::new();
    let mut reader = response.into_reader().take(max_size + 1);
    reader.read_to_string(&mut body)
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Check if we hit the limit (read more than max_size)
    if body.len() as u64 > max_size {
        return Err(format!("File too large (max {} bytes)", max_size));
    }

    Ok(body)
}

/// Strip % delimiters from variable name for user-friendly display
pub fn display_var_name(name: &str) -> &str {
    name.trim_start_matches('%').trim_end_matches('%')
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod validate_template_name_tests {
        use super::*;

        #[test]
        fn accepts_valid_name() {
            assert_eq!(
                validate_template_name("My Template"),
                Ok("My Template".to_string())
            );
        }

        #[test]
        fn trims_whitespace() {
            assert_eq!(
                validate_template_name("  My Template  "),
                Ok("My Template".to_string())
            );
        }

        #[test]
        fn rejects_empty_name() {
            assert!(validate_template_name("").is_err());
            assert!(validate_template_name("   ").is_err());
        }

        #[test]
        fn rejects_name_exceeding_max_length() {
            let long_name = "a".repeat(101);
            let result = validate_template_name(&long_name);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("100 characters"));
        }

        #[test]
        fn accepts_name_at_max_length() {
            let max_name = "a".repeat(100);
            assert!(validate_template_name(&max_name).is_ok());
        }

        #[test]
        fn rejects_control_characters() {
            assert!(validate_template_name("My\x00Template").is_err());
            assert!(validate_template_name("My\nTemplate").is_err());
            assert!(validate_template_name("My\tTemplate").is_err());
        }

        #[test]
        fn accepts_unicode() {
            assert_eq!(
                validate_template_name("模板名称"),
                Ok("模板名称".to_string())
            );
            assert_eq!(
                validate_template_name("Plantilla España"),
                Ok("Plantilla España".to_string())
            );
        }

        #[test]
        fn accepts_special_characters() {
            assert_eq!(
                validate_template_name("My-Template_v2.0 (Final)"),
                Ok("My-Template_v2.0 (Final)".to_string())
            );
        }
    }

    mod validate_import_url_tests {
        use super::*;

        #[test]
        fn accepts_https_url() {
            assert!(validate_import_url("https://example.com/template.sct").is_ok());
        }

        #[test]
        fn rejects_http_url() {
            let result = validate_import_url("http://example.com/template.sct");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("HTTP is not allowed"));
        }

        #[test]
        fn rejects_file_scheme() {
            let result = validate_import_url("file:///etc/passwd");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("not allowed"));
        }

        #[test]
        fn rejects_ftp_scheme() {
            let result = validate_import_url("ftp://example.com/file");
            assert!(result.is_err());
        }

        #[test]
        fn rejects_localhost() {
            assert!(validate_import_url("https://localhost/template.sct").is_err());
            assert!(validate_import_url("https://localhost:8080/template.sct").is_err());
            assert!(validate_import_url("https://LOCALHOST/template.sct").is_err());
        }

        #[test]
        fn rejects_local_domain() {
            assert!(validate_import_url("https://myserver.local/template.sct").is_err());
            assert!(validate_import_url("https://app.internal/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_loopback() {
            assert!(validate_import_url("https://127.0.0.1/template.sct").is_err());
            assert!(validate_import_url("https://127.0.0.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_private_class_a() {
            assert!(validate_import_url("https://10.0.0.1/template.sct").is_err());
            assert!(validate_import_url("https://10.255.255.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_private_class_b() {
            assert!(validate_import_url("https://172.16.0.1/template.sct").is_err());
            assert!(validate_import_url("https://172.31.255.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_private_class_c() {
            assert!(validate_import_url("https://192.168.0.1/template.sct").is_err());
            assert!(validate_import_url("https://192.168.255.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_link_local() {
            assert!(validate_import_url("https://169.254.169.254/latest/meta-data/").is_err());
            assert!(validate_import_url("https://169.254.0.1/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv6_loopback() {
            assert!(validate_import_url("https://[::1]/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv6_unique_local() {
            assert!(validate_import_url("https://[fc00::1]/template.sct").is_err());
            assert!(validate_import_url("https://[fd00::1]/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv6_link_local() {
            assert!(validate_import_url("https://[fe80::1]/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_mapped_ipv6() {
            assert!(validate_import_url("https://[::ffff:127.0.0.1]/template.sct").is_err());
            assert!(validate_import_url("https://[::ffff:192.168.1.1]/template.sct").is_err());
            assert!(validate_import_url("https://[::ffff:10.0.0.1]/template.sct").is_err());
            assert!(validate_import_url("https://[::ffff:169.254.169.254]/template.sct").is_err());
        }

        #[test]
        fn accepts_public_ipv4() {
            assert!(validate_import_url("https://8.8.8.8/template.sct").is_ok());
            assert!(validate_import_url("https://1.1.1.1/template.sct").is_ok());
        }

        #[test]
        fn rejects_invalid_url() {
            assert!(validate_import_url("not a url").is_err());
            assert!(validate_import_url("").is_err());
        }

        #[test]
        fn rejects_url_without_host() {
            assert!(validate_import_url("data:text/plain,hello").is_err());
        }
    }

    mod version_validation_tests {
        use super::*;

        #[test]
        fn accepts_valid_versions() {
            assert!(is_valid_version("1.0"));
            assert!(is_valid_version("1.1"));
            assert!(is_valid_version("1.9"));
            assert!(is_valid_version("1.10"));
            assert!(is_valid_version("1.0.0"));
        }

        #[test]
        fn rejects_invalid_versions() {
            assert!(!is_valid_version("2.0"));
            assert!(!is_valid_version("1."));
            assert!(!is_valid_version("1.x"));
            assert!(!is_valid_version("1"));
            assert!(!is_valid_version(""));
            assert!(!is_valid_version("v1.0"));
            assert!(!is_valid_version("1.0abc"));
            assert!(!is_valid_version("1.0."));
        }
    }
}
