//! Variable transformation module for Structure Creator.
//!
//! Supports syntax like:
//! - `%VAR%` - direct substitution
//! - `%VAR:uppercase%` - transform to UPPERCASE
//! - `%VAR:lowercase%` - transform to lowercase
//! - `%VAR:camelCase%` - transform to camelCase
//! - `%VAR:PascalCase%` - transform to PascalCase
//! - `%VAR:kebab-case%` - transform to kebab-case
//! - `%VAR:snake_case%` - transform to snake_case
//! - `%VAR:plural%` - pluralize the value
//! - `%VAR:length%` - return character count
//! - `%DATE:format(YYYY-MM-DD)%` - format date

use chrono::{Datelike, NaiveDate};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};

/// Pre-compiled regex for variable references - compiled once at first use
static VAR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"%([A-Za-z_][A-Za-z0-9_]*)(?::([a-zA-Z_-]+)(?:\(([^)]*)\))?)?%")
        .expect("Invalid variable reference regex - this is a bug")
});

/// Supported transformation types
#[derive(Debug, Clone, PartialEq)]
pub enum Transform {
    Uppercase,
    Lowercase,
    CamelCase,
    PascalCase,
    KebabCase,
    SnakeCase,
    Plural,
    Length,
    DateFormat(String),
}

/// Parsed variable reference
#[derive(Debug, Clone)]
pub struct VariableRef {
    /// The full match including % delimiters (e.g., "%NAME:uppercase%")
    pub full_match: String,
    /// The base variable name with % delimiters (e.g., "%NAME%")
    pub base_name: String,
    /// Optional transformation to apply
    pub transform: Option<Transform>,
    /// If transform name was provided but not recognized
    pub unknown_transform: Option<String>,
}

/// Parse a transformation name and optional arguments into a Transform
fn parse_transform(name: &str, args: Option<&str>) -> Result<Transform, String> {
    match name.to_lowercase().as_str() {
        "uppercase" | "upper" => Ok(Transform::Uppercase),
        "lowercase" | "lower" => Ok(Transform::Lowercase),
        "camelcase" | "camel" => Ok(Transform::CamelCase),
        "pascalcase" | "pascal" => Ok(Transform::PascalCase),
        "kebab-case" | "kebab" => Ok(Transform::KebabCase),
        "snake_case" | "snake" => Ok(Transform::SnakeCase),
        "plural" | "pluralize" => Ok(Transform::Plural),
        "length" | "len" => Ok(Transform::Length),
        "format" => {
            let fmt = args.unwrap_or("YYYY-MM-DD");
            Ok(Transform::DateFormat(fmt.to_string()))
        }
        unknown => Err(unknown.to_string()),
    }
}

/// Find all variable references in text, including those with transformations.
/// Returns a list of VariableRef structs.
pub fn find_variable_refs(text: &str) -> Vec<VariableRef> {
    let mut refs = Vec::new();
    let mut seen = HashSet::new();

    for cap in VAR_REGEX.captures_iter(text) {
        let full_match = cap.get(0).unwrap().as_str().to_string();

        // Deduplicate - same full match only processed once
        if seen.contains(&full_match) {
            continue;
        }
        seen.insert(full_match.clone());

        let var_name = cap.get(1).unwrap().as_str();
        let base_name = format!("%{}%", var_name);

        let (transform, unknown_transform) = if let Some(transform_name) = cap.get(2) {
            let args = cap.get(3).map(|m| m.as_str());
            match parse_transform(transform_name.as_str(), args) {
                Ok(t) => (Some(t), None),
                Err(unknown) => (None, Some(unknown)),
            }
        } else {
            (None, None)
        };

        refs.push(VariableRef {
            full_match,
            base_name,
            transform,
            unknown_transform,
        });
    }

    refs
}

/// Apply a transformation to a value
pub fn apply_transform(value: &str, transform: &Transform) -> String {
    match transform {
        Transform::Uppercase => value.to_uppercase(),
        Transform::Lowercase => value.to_lowercase(),
        Transform::CamelCase => to_camel_case(value),
        Transform::PascalCase => to_pascal_case(value),
        Transform::KebabCase => to_kebab_case(value),
        Transform::SnakeCase => to_snake_case(value),
        Transform::Plural => pluralize(value),
        Transform::Length => value.chars().count().to_string(),
        Transform::DateFormat(fmt) => format_date(value, fmt),
    }
}

/// Substitute all variables in text, applying transformations as needed.
/// This replaces the simple string.replace() loop used previously.
///
/// Unknown transformations are silently left as-is (the variable reference remains unchanged).
/// This allows forward compatibility with new transforms while making typos visible in output.
pub fn substitute_variables(text: &str, variables: &HashMap<String, String>) -> String {
    let refs = find_variable_refs(text);
    let mut result = text.to_string();

    for var_ref in refs {
        // Skip unknown transformations - they remain in the output unchanged
        // This makes typos visible to users (e.g., %NAME:uppercse% stays as-is)
        if var_ref.unknown_transform.is_some() {
            continue;
        }

        // Look up the base variable value
        if let Some(value) = variables.get(&var_ref.base_name) {
            // Apply transformation if present
            let final_value = match &var_ref.transform {
                Some(transform) => apply_transform(value, transform),
                None => value.clone(),
            };
            // Replace the full match (including any transformation syntax)
            result = result.replace(&var_ref.full_match, &final_value);
        }
    }

    result
}

// ============================================================================
// Case Transformation Helpers
// ============================================================================

/// Split a string into words, handling various input formats
fn split_into_words(s: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current_word = String::new();

    for c in s.chars() {
        if c == '_' || c == '-' || c == ' ' {
            // Delimiter found
            if !current_word.is_empty() {
                words.push(current_word.to_lowercase());
                current_word = String::new();
            }
        } else if c.is_uppercase() && !current_word.is_empty() {
            // CamelCase boundary
            words.push(current_word.to_lowercase());
            current_word = c.to_string();
        } else {
            current_word.push(c);
        }
    }

    if !current_word.is_empty() {
        words.push(current_word.to_lowercase());
    }

    words
}

/// Convert to camelCase: "hello world" -> "helloWorld"
fn to_camel_case(s: &str) -> String {
    let words = split_into_words(s);
    if words.is_empty() {
        return String::new();
    }

    let mut result = words[0].clone();
    for word in words.iter().skip(1) {
        result.push_str(&capitalize_first(word));
    }
    result
}

/// Convert to PascalCase: "hello world" -> "HelloWorld"
fn to_pascal_case(s: &str) -> String {
    let words = split_into_words(s);
    words.iter().map(|w| capitalize_first(w)).collect()
}

/// Convert to kebab-case: "HelloWorld" -> "hello-world"
fn to_kebab_case(s: &str) -> String {
    let words = split_into_words(s);
    words.join("-")
}

/// Convert to snake_case: "HelloWorld" -> "hello_world"
fn to_snake_case(s: &str) -> String {
    let words = split_into_words(s);
    words.join("_")
}

/// Capitalize the first letter of a string
fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

// ============================================================================
// Pluralization
// ============================================================================

/// Simple English pluralization rules
fn pluralize(s: &str) -> String {
    // Handle empty string
    if s.is_empty() {
        return String::new();
    }

    let s_lower = s.to_lowercase();

    // Irregular plurals (extended list)
    let irregulars: &[(&str, &str)] = &[
        ("child", "children"),
        ("person", "people"),
        ("man", "men"),
        ("woman", "women"),
        ("tooth", "teeth"),
        ("foot", "feet"),
        ("mouse", "mice"),
        ("goose", "geese"),
        ("ox", "oxen"),
        ("fish", "fish"),
        ("sheep", "sheep"),
        ("deer", "deer"),
        ("moose", "moose"),
        ("series", "series"),
        ("species", "species"),
        ("aircraft", "aircraft"),
        ("offspring", "offspring"),
        ("cactus", "cacti"),
        ("focus", "foci"),
        ("fungus", "fungi"),
        ("nucleus", "nuclei"),
        ("syllabus", "syllabi"),
        ("analysis", "analyses"),
        ("diagnosis", "diagnoses"),
        ("thesis", "theses"),
        ("crisis", "crises"),
        ("phenomenon", "phenomena"),
        ("criterion", "criteria"),
        ("datum", "data"),
        ("index", "indices"),
        ("appendix", "appendices"),
        ("life", "lives"),
        ("wife", "wives"),
        ("elf", "elves"),
        ("shelf", "shelves"),
        ("self", "selves"),
        ("half", "halves"),
        ("calf", "calves"),
        ("loaf", "loaves"),
        ("wolf", "wolves"),
    ];

    for (singular, plural) in irregulars {
        if s_lower == *singular {
            // Preserve original case pattern
            if s.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                return capitalize_first(plural);
            }
            return plural.to_string();
        }
    }

    // Get the string as chars for safe Unicode handling
    let chars: Vec<char> = s.chars().collect();
    let chars_lower: Vec<char> = s_lower.chars().collect();

    // Words ending in 'y' preceded by consonant -> 'ies'
    if chars_lower.last() == Some(&'y') && chars.len() > 1 {
        let second_last = chars_lower.get(chars_lower.len() - 2).copied().unwrap_or('a');
        if !"aeiou".contains(second_last) {
            let without_y: String = chars[..chars.len() - 1].iter().collect();
            return format!("{}ies", without_y);
        }
    }

    // Words ending in 's', 'x', 'z', 'ch', 'sh' -> add 'es'
    if s_lower.ends_with('s')
        || s_lower.ends_with('x')
        || s_lower.ends_with('z')
        || s_lower.ends_with("ch")
        || s_lower.ends_with("sh")
    {
        return format!("{}es", s);
    }

    // Words ending in consonant + 'o' -> add 'es' (potato -> potatoes)
    // But many words ending in 'o' just add 's' (photo, piano, etc.)
    let o_exceptions = [
        "photo", "piano", "halo", "studio", "video", "radio", "ratio",
        "portfolio", "patio", "cello", "memo", "solo", "euro", "auto",
        "zoo", "kangaroo", "bamboo", "tattoo", "taboo", "voodoo", "shampoo",
        "pro", "disco", "limo", "info", "demo", "logo", "motto",
    ];

    if s_lower.ends_with('o') && chars.len() > 1 {
        let second_last = chars_lower.get(chars_lower.len() - 2).copied().unwrap_or('a');
        // If preceded by a consonant and not an exception, add 'es'
        if !"aeiou".contains(second_last) && !o_exceptions.contains(&s_lower.as_str()) {
            return format!("{}es", s);
        }
    }

    // Words ending in 'f' or 'fe' -> 'ves', but many exceptions just add 's'
    // These common words ending in 'f' just add 's' (don't convert to 'ves')
    let f_exceptions = [
        "roof", "chief", "belief", "brief", "cliff", "proof", "reef",
        "grief", "safe", "chef", "fief", "gulf", "surf", "turf",
        "motif", "sheriff", "tariff", "plaintiff", "bailiff",
    ];

    if s_lower.ends_with("fe") && chars.len() > 2 {
        // Check if it's an exception (like "safe")
        if !f_exceptions.contains(&s_lower.as_str()) {
            let without_fe: String = chars[..chars.len() - 2].iter().collect();
            return format!("{}ves", without_fe);
        }
    }
    if s_lower.ends_with('f') && chars.len() > 1 {
        // Check if it's an exception (like "roof", "chief")
        if !f_exceptions.contains(&s_lower.as_str()) {
            let without_f: String = chars[..chars.len() - 1].iter().collect();
            return format!("{}ves", without_f);
        }
    }

    // Default: add 's'
    format!("{}s", s)
}

// ============================================================================
// Date Formatting
// ============================================================================

/// Format a date value using a format string.
/// Uses token-based replacement to avoid order-dependent bugs.
/// Supports: YYYY, YY, MMMM, MMM, MM, DD, D
///
/// # Date Parsing Order
/// When the input value is a date string (not "today"/"now"), the function
/// attempts to parse it in this order:
/// 1. ISO format: YYYY-MM-DD (e.g., "2024-01-15")
/// 2. US format: MM/DD/YYYY (e.g., "01/15/2024")
/// 3. EU format: DD/MM/YYYY (e.g., "15/01/2024")
///
/// **Important**: For ambiguous dates like "01/02/2024", the US format is tried
/// first, so this would be parsed as January 2nd, not February 1st. Use ISO
/// format (YYYY-MM-DD) to avoid ambiguity.
fn format_date(value: &str, format: &str) -> String {
    // Handle preset formats (resolve aliases to actual format strings)
    let resolved_format = match format.to_lowercase().as_str() {
        "iso" => "YYYY-MM-DD",
        "us" => "MM/DD/YYYY",
        "eu" => "DD/MM/YYYY",
        _ => format,
    };

    // Try to parse the value as a date
    let date = if value.to_lowercase() == "today" || value.to_lowercase() == "now" {
        chrono::Local::now().date_naive()
    } else if let Ok(d) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        d
    } else if let Ok(d) = NaiveDate::parse_from_str(value, "%m/%d/%Y") {
        d
    } else if let Ok(d) = NaiveDate::parse_from_str(value, "%d/%m/%Y") {
        d
    } else {
        // Can't parse as date, return original
        return value.to_string();
    };

    // Month names
    let months_full = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let months_short = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];

    // Get date components (month0 returns 0-11, month/day return 1-based)
    let month_idx = date.month0() as usize;
    let year_full = format!("{:04}", date.year());
    let year_short = format!("{:02}", date.year() % 100);
    let month_full = months_full[month_idx].to_string();
    let month_short = months_short[month_idx].to_string();
    let month_num = format!("{:02}", date.month());
    let day_padded = format!("{:02}", date.day());
    let day_unpadded = format!("{}", date.day());

    // Token-based replacement (process longer tokens first to avoid conflicts)
    // Use a placeholder approach to avoid double-replacement
    let mut result = resolved_format.to_string();

    // Replace tokens with unique placeholders first, then substitute values.
    //
    // Placeholders use null bytes (\x00) which are extremely unlikely to appear
    // in user-provided date format strings. Each placeholder has a unique numeric
    // ID (\x01 through \x07) sandwiched between null bytes to prevent any overlap
    // with token names or replacement values. This two-pass approach ensures that
    // replacing "YYYY" with "2024" doesn't cause "YY" to incorrectly match the
    // "24" part of the already-replaced value.
    let replacements = [
        ("YYYY", "\x00\x011\x00", &year_full),
        ("YY", "\x00\x012\x00", &year_short),
        ("MMMM", "\x00\x013\x00", &month_full),
        ("MMM", "\x00\x014\x00", &month_short),
        ("MM", "\x00\x015\x00", &month_num),
        ("DD", "\x00\x016\x00", &day_padded),
        ("D", "\x00\x017\x00", &day_unpadded),
    ];

    // First pass: replace tokens with placeholders (longest first)
    for (token, placeholder, _) in &replacements {
        result = result.replace(token, placeholder);
    }

    // Second pass: replace placeholders with actual values
    for (_, placeholder, value) in &replacements {
        result = result.replace(placeholder, value);
    }

    result
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_variable_refs_simple() {
        let refs = find_variable_refs("Hello %NAME%!");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].full_match, "%NAME%");
        assert_eq!(refs[0].base_name, "%NAME%");
        assert!(refs[0].transform.is_none());
        assert!(refs[0].unknown_transform.is_none());
    }

    #[test]
    fn test_find_variable_refs_with_transform() {
        let refs = find_variable_refs("Hello %NAME:uppercase%!");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].full_match, "%NAME:uppercase%");
        assert_eq!(refs[0].base_name, "%NAME%");
        assert_eq!(refs[0].transform, Some(Transform::Uppercase));
    }

    #[test]
    fn test_find_variable_refs_with_args() {
        let refs = find_variable_refs("Date: %DATE:format(YYYY-MM-DD)%");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].full_match, "%DATE:format(YYYY-MM-DD)%");
        assert_eq!(refs[0].base_name, "%DATE%");
        assert_eq!(
            refs[0].transform,
            Some(Transform::DateFormat("YYYY-MM-DD".to_string()))
        );
    }

    #[test]
    fn test_find_variable_refs_unknown_transform() {
        let refs = find_variable_refs("Hello %NAME:unknownTransform%!");
        assert_eq!(refs.len(), 1);
        assert!(refs[0].transform.is_none());
        assert_eq!(refs[0].unknown_transform, Some("unknowntransform".to_string()));
    }

    #[test]
    fn test_find_variable_refs_deduplication() {
        let refs = find_variable_refs("%NAME% %NAME% %NAME:upper%");
        // Should have 2 unique refs: %NAME% and %NAME:upper%
        assert_eq!(refs.len(), 2);
    }

    #[test]
    fn test_substitute_simple() {
        let mut vars = HashMap::new();
        vars.insert("%NAME%".to_string(), "world".to_string());

        let result = substitute_variables("Hello %NAME%!", &vars);
        assert_eq!(result, "Hello world!");
    }

    #[test]
    fn test_substitute_with_transform() {
        let mut vars = HashMap::new();
        vars.insert("%NAME%".to_string(), "hello world".to_string());

        assert_eq!(
            substitute_variables("%NAME:uppercase%", &vars),
            "HELLO WORLD"
        );
        assert_eq!(
            substitute_variables("%NAME:camelCase%", &vars),
            "helloWorld"
        );
        assert_eq!(
            substitute_variables("%NAME:PascalCase%", &vars),
            "HelloWorld"
        );
        assert_eq!(
            substitute_variables("%NAME:kebab-case%", &vars),
            "hello-world"
        );
        assert_eq!(
            substitute_variables("%NAME:snake_case%", &vars),
            "hello_world"
        );
    }

    #[test]
    fn test_case_conversions() {
        // From space-separated
        assert_eq!(to_camel_case("hello world"), "helloWorld");
        assert_eq!(to_pascal_case("hello world"), "HelloWorld");

        // From PascalCase
        assert_eq!(to_kebab_case("HelloWorld"), "hello-world");
        assert_eq!(to_snake_case("HelloWorld"), "hello_world");

        // From snake_case
        assert_eq!(to_camel_case("hello_world"), "helloWorld");
        assert_eq!(to_pascal_case("hello_world"), "HelloWorld");

        // From kebab-case
        assert_eq!(to_camel_case("hello-world"), "helloWorld");
        assert_eq!(to_pascal_case("hello-world"), "HelloWorld");
    }

    #[test]
    fn test_pluralize() {
        // Regular
        assert_eq!(pluralize("cat"), "cats");
        assert_eq!(pluralize("dog"), "dogs");

        // Ending in s, x, z, ch, sh
        assert_eq!(pluralize("box"), "boxes");
        assert_eq!(pluralize("bus"), "buses");
        assert_eq!(pluralize("watch"), "watches");
        assert_eq!(pluralize("dish"), "dishes");

        // Ending in y
        assert_eq!(pluralize("baby"), "babies");
        assert_eq!(pluralize("city"), "cities");
        assert_eq!(pluralize("day"), "days"); // vowel + y

        // Ending in f/fe
        assert_eq!(pluralize("leaf"), "leaves");
        assert_eq!(pluralize("knife"), "knives");

        // Irregular
        assert_eq!(pluralize("child"), "children");
        assert_eq!(pluralize("person"), "people");
        assert_eq!(pluralize("Child"), "Children");
        assert_eq!(pluralize("fish"), "fish");
        assert_eq!(pluralize("sheep"), "sheep");
        assert_eq!(pluralize("cactus"), "cacti");
        assert_eq!(pluralize("analysis"), "analyses");
    }

    #[test]
    fn test_pluralize_unicode() {
        // Test that Unicode strings don't panic
        assert_eq!(pluralize("café"), "cafés");
        assert_eq!(pluralize("naïve"), "naïves");
    }

    #[test]
    fn test_pluralize_empty_string() {
        assert_eq!(pluralize(""), "");
    }

    #[test]
    fn test_pluralize_f_exceptions() {
        // Words ending in 'f' that just add 's' (not 'ves')
        assert_eq!(pluralize("roof"), "roofs");
        assert_eq!(pluralize("chief"), "chiefs");
        assert_eq!(pluralize("belief"), "beliefs");
        assert_eq!(pluralize("cliff"), "cliffs");
        assert_eq!(pluralize("proof"), "proofs");
        assert_eq!(pluralize("safe"), "safes");
    }

    #[test]
    fn test_pluralize_consonant_o() {
        // Words ending in consonant + 'o' add 'es'
        assert_eq!(pluralize("potato"), "potatoes");
        assert_eq!(pluralize("tomato"), "tomatoes");
        assert_eq!(pluralize("hero"), "heroes");
        assert_eq!(pluralize("echo"), "echoes");
        assert_eq!(pluralize("veto"), "vetoes");
        // But exceptions just add 's'
        assert_eq!(pluralize("photo"), "photos");
        assert_eq!(pluralize("piano"), "pianos");
        assert_eq!(pluralize("video"), "videos");
        assert_eq!(pluralize("radio"), "radios");
        assert_eq!(pluralize("zoo"), "zoos"); // vowel + o
    }

    #[test]
    fn test_pluralize_multi_word() {
        // Multi-word strings: only the last word gets pluralized
        // This works because pluralize only looks at the ending
        assert_eq!(pluralize("tax return"), "tax returns");
        assert_eq!(pluralize("ice cream"), "ice creams");
        assert_eq!(pluralize("school bus"), "school buses");
        assert_eq!(pluralize("file system"), "file systems");
    }

    #[test]
    fn test_length_transform() {
        let mut vars = HashMap::new();
        vars.insert("%NAME%".to_string(), "hello".to_string());

        assert_eq!(substitute_variables("%NAME:length%", &vars), "5");
    }

    #[test]
    fn test_length_transform_unicode() {
        let mut vars = HashMap::new();
        vars.insert("%NAME%".to_string(), "héllo".to_string());

        // Should count characters, not bytes
        assert_eq!(substitute_variables("%NAME:length%", &vars), "5");
    }

    #[test]
    fn test_date_format_iso() {
        let mut vars = HashMap::new();
        vars.insert("%DATE%".to_string(), "2024-01-15".to_string());

        assert_eq!(
            substitute_variables("%DATE:format(YYYY-MM-DD)%", &vars),
            "2024-01-15"
        );
    }

    #[test]
    fn test_date_format_us() {
        let mut vars = HashMap::new();
        vars.insert("%DATE%".to_string(), "2024-01-15".to_string());

        assert_eq!(
            substitute_variables("%DATE:format(MM/DD/YYYY)%", &vars),
            "01/15/2024"
        );
    }

    #[test]
    fn test_date_format_with_month_names() {
        let mut vars = HashMap::new();
        vars.insert("%DATE%".to_string(), "2024-01-15".to_string());

        assert_eq!(
            substitute_variables("%DATE:format(MMMM DD, YYYY)%", &vars),
            "January 15, 2024"
        );
        assert_eq!(
            substitute_variables("%DATE:format(MMM D, YYYY)%", &vars),
            "Jan 15, 2024"
        );
    }

    #[test]
    fn test_date_format_preset() {
        let mut vars = HashMap::new();
        vars.insert("%DATE%".to_string(), "2024-01-15".to_string());

        assert_eq!(
            substitute_variables("%DATE:format(iso)%", &vars),
            "2024-01-15"
        );
        assert_eq!(
            substitute_variables("%DATE:format(us)%", &vars),
            "01/15/2024"
        );
        assert_eq!(
            substitute_variables("%DATE:format(eu)%", &vars),
            "15/01/2024"
        );
    }

    #[test]
    fn test_date_format_no_double_replacement() {
        // Ensure "MM" in month name doesn't get double-replaced
        let mut vars = HashMap::new();
        vars.insert("%DATE%".to_string(), "2024-01-15".to_string());

        // January doesn't contain MM, but this tests the mechanism
        let result = substitute_variables("%DATE:format(MMMM-MM-DD)%", &vars);
        assert_eq!(result, "January-01-15");
    }
}
