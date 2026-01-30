//! Validation commands for variables and schemas.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use regex::Regex;

use crate::database::ValidationRule;
use crate::diff_preview::generate_diff_preview;
use crate::schema::{SchemaTree, TemplateData};
use crate::state::AppState;
use crate::types::{DiffResult, ValidationError};
use crate::utils::{display_var_name, MAX_REGEX_PATTERN_LENGTH};
use crate::validation::{validate_schema, SchemaValidationResult};

/// Error type for regex pattern compilation failures
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatternError {
    TooLong,
    InvalidRegex,
}

/// Validate variables against their validation rules.
///
/// Returns a list of validation errors sorted by variable name for consistent ordering.
/// Pre-compiles regex patterns for efficiency when validating multiple variables.
pub fn validate_variables(
    variables: &HashMap<String, String>,
    rules: &HashMap<String, ValidationRule>,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    // Pre-compile all regex patterns to avoid recompilation on each validation
    // Patterns exceeding MAX_REGEX_PATTERN_LENGTH are treated as invalid
    let compiled_patterns: HashMap<&String, Result<Regex, PatternError>> = rules
        .iter()
        .filter_map(|(name, rule)| {
            rule.pattern.as_ref().map(|pattern| {
                if pattern.len() > MAX_REGEX_PATTERN_LENGTH {
                    (name, Err(PatternError::TooLong))
                } else {
                    (name, Regex::new(pattern).map_err(|_| PatternError::InvalidRegex))
                }
            })
        })
        .collect();

    // Sort rules by name for deterministic error ordering
    let mut sorted_rules: Vec<_> = rules.iter().collect();
    sorted_rules.sort_by(|a, b| a.0.cmp(b.0));

    for (name, rule) in sorted_rules {
        let value = variables.get(name).map(|s| s.as_str()).unwrap_or("");
        // Use clean display name (without % delimiters) for both variable_name and messages
        let display_name = display_var_name(name).to_string();

        // Validate rule sanity: min_length should not exceed max_length
        if let (Some(min), Some(max)) = (rule.min_length, rule.max_length) {
            if min > max {
                errors.push(ValidationError {
                    variable_name: display_name.clone(),
                    message: format!(
                        "Invalid rule for {}: min length ({}) exceeds max length ({})",
                        display_name, min, max
                    ),
                });
                continue;
            }
        }

        if rule.required && value.is_empty() {
            errors.push(ValidationError {
                variable_name: display_name.clone(),
                message: format!("{} is required", display_name),
            });
            continue;
        }

        if !value.is_empty() {
            // Use chars().count() for proper Unicode character counting
            let char_count = value.chars().count();

            if let Some(min) = rule.min_length {
                if char_count < min {
                    errors.push(ValidationError {
                        variable_name: display_name.clone(),
                        message: format!("{} must be at least {} characters", display_name, min),
                    });
                }
            }

            if let Some(max) = rule.max_length {
                if char_count > max {
                    errors.push(ValidationError {
                        variable_name: display_name.clone(),
                        message: format!("{} must be at most {} characters", display_name, max),
                    });
                }
            }

            // Use pre-compiled regex pattern
            if let Some(compiled_result) = compiled_patterns.get(name) {
                match compiled_result {
                    Ok(re) => {
                        if !re.is_match(value) {
                            errors.push(ValidationError {
                                variable_name: display_name.clone(),
                                message: format!("{} does not match required pattern", display_name),
                            });
                        }
                    }
                    Err(PatternError::TooLong) => {
                        errors.push(ValidationError {
                            variable_name: display_name.clone(),
                            message: format!(
                                "Regex pattern for {} exceeds maximum length of {} characters",
                                display_name, MAX_REGEX_PATTERN_LENGTH
                            ),
                        });
                    }
                    Err(PatternError::InvalidRegex) => {
                        errors.push(ValidationError {
                            variable_name: display_name.clone(),
                            message: format!("Invalid regex pattern for {}", display_name),
                        });
                    }
                }
            }
        }
    }

    errors
}

#[tauri::command]
pub fn cmd_validate_variables(
    variables: HashMap<String, String>,
    rules: HashMap<String, ValidationRule>,
) -> Result<Vec<ValidationError>, String> {
    Ok(validate_variables(&variables, &rules))
}

#[tauri::command]
pub fn cmd_validate_schema(
    state: State<Mutex<AppState>>,
    content: String,
    variables: HashMap<String, String>,
) -> Result<SchemaValidationResult, String> {
    let state_guard = state.lock().map_err(|e| e.to_string())?;

    // Create a template loader closure that looks up templates from the database
    let loader = |name: &str| -> Option<TemplateData> {
        state_guard
            .db
            .get_template_by_name(name)
            .ok()
            .flatten()
            .map(|t| TemplateData {
                schema_xml: t.schema_xml,
                variables: t.variables,
                variable_validation: t
                    .variable_validation
                    .into_iter()
                    .map(|(k, v)| (k, v.into()))
                    .collect(),
            })
    };

    Ok(validate_schema(&content, &variables, Some(&loader)))
}

#[tauri::command]
pub fn cmd_generate_diff_preview(
    tree: SchemaTree,
    output_path: String,
    variables: HashMap<String, String>,
    overwrite: bool,
) -> Result<DiffResult, String> {
    generate_diff_preview(&tree, &output_path, &variables, overwrite)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod validate_variables_tests {
        use super::*;

        #[test]
        fn passes_with_no_rules() {
            let variables = HashMap::new();
            let rules = HashMap::new();
            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn validates_required_field() {
            let variables: HashMap<String, String> = HashMap::new();
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("required"));
        }

        #[test]
        fn validates_required_with_empty_value() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("required"));
        }

        #[test]
        fn passes_required_with_value() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn validates_min_length() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "ab".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(5),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("at least 5"));
        }

        #[test]
        fn validates_max_length() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "abcdefghij".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    max_length: Some(5),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("at most 5"));
        }

        #[test]
        fn validates_min_length_with_unicode() {
            let mut variables = HashMap::new();
            // "héllo" is 5 characters but 6 bytes
            variables.insert("%NAME%".to_string(), "héllo".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(6),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("at least 6"));
        }

        #[test]
        fn validates_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "invalid!".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some("^[a-z]+$".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("does not match"));
        }

        #[test]
        fn passes_valid_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "validname".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some("^[a-z]+$".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn handles_invalid_regex_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some("[invalid".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("Invalid regex"));
        }

        #[test]
        fn validates_rule_sanity_min_exceeds_max() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(10),
                    max_length: Some(5),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0]
                .message
                .contains("min length (10) exceeds max length (5)"));
        }

        #[test]
        fn validates_multiple_rules() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "ab".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(5),
                    pattern: Some("^[0-9]+$".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            // Should have 2 errors: min_length and pattern
            assert_eq!(errors.len(), 2);
        }

        #[test]
        fn skips_length_validation_for_empty_non_required() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(5),
                    required: false,
                    ..Default::default()
                },
            );

            // Empty value with non-required field should not trigger min_length error
            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn strips_percent_delimiters_in_display_name() {
            let variables: HashMap<String, String> = HashMap::new();
            let mut rules = HashMap::new();
            rules.insert(
                "%MY_VAR%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            // Both variable_name and message should use clean names without % delimiters
            assert_eq!(errors[0].variable_name, "MY_VAR");
            assert!(errors[0].message.contains("MY_VAR is required"));
            assert!(!errors[0].message.contains("%"));
        }

        #[test]
        fn rejects_overly_long_regex_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            // Create a pattern longer than MAX_REGEX_PATTERN_LENGTH (1000)
            let long_pattern = "a".repeat(1001);
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some(long_pattern),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("exceeds maximum length"));
        }

        #[test]
        fn errors_are_sorted_by_variable_name() {
            let variables: HashMap<String, String> = HashMap::new();
            let mut rules = HashMap::new();
            // Insert in non-alphabetical order
            rules.insert(
                "%ZEBRA%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );
            rules.insert(
                "%APPLE%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );
            rules.insert(
                "%MANGO%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 3);
            // Errors should be sorted alphabetically by variable name (clean names without % delimiters)
            assert_eq!(errors[0].variable_name, "APPLE");
            assert_eq!(errors[1].variable_name, "MANGO");
            assert_eq!(errors[2].variable_name, "ZEBRA");
        }
    }
}
