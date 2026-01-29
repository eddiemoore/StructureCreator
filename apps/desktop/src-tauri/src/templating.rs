//! Template processing module for file content.
//!
//! Provides conditional and loop constructs for file content when `template="true"` attribute is set.
//! This is opt-in to avoid conflicts with Handlebars/Mustache files.
//!
//! Supported syntax:
//! - `{{if VAR}}...{{endif}}` - conditional inclusion
//! - `{{if VAR}}...{{else}}...{{endif}}` - conditional with alternative
//! - `{{for item in VAR}}...{{endfor}}` - loop over comma-separated values
//! - `{{item}}` - loop variable reference (inside for loops)
//!
//! Note: `%VAR%` substitution is handled separately by the transforms module.

use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};

/// Maximum nesting depth for template blocks to prevent runaway recursion
const MAX_NESTING_DEPTH: usize = 20;

/// Error types for template processing
#[derive(Debug, Clone, PartialEq)]
pub enum TemplateError {
    UnclosedIf { var: String },
    UnclosedFor { var: String, item: String },
    UnexpectedEndif,
    UnexpectedEndfor,
    UnexpectedElse,
    MaxDepthExceeded,
    InvalidForSyntax { details: String },
}

impl std::fmt::Display for TemplateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TemplateError::UnclosedIf { var } => {
                write!(f, "Unclosed {{{{if {}}}}} block", var)
            }
            TemplateError::UnclosedFor { var, item } => {
                write!(f, "Unclosed {{{{for {} in {}}}}} block", item, var)
            }
            TemplateError::UnexpectedEndif => {
                write!(f, "Unexpected {{{{endif}}}} without matching {{{{if}}}}")
            }
            TemplateError::UnexpectedEndfor => {
                write!(f, "Unexpected {{{{endfor}}}} without matching {{{{for}}}}")
            }
            TemplateError::UnexpectedElse => {
                write!(f, "Unexpected {{{{else}}}} without matching {{{{if}}}}")
            }
            TemplateError::MaxDepthExceeded => {
                write!(f, "Maximum nesting depth ({}) exceeded", MAX_NESTING_DEPTH)
            }
            TemplateError::InvalidForSyntax { details } => {
                write!(f, "Invalid {{{{for}}}} syntax: {}", details)
            }
        }
    }
}

impl std::error::Error for TemplateError {}

/// Pre-compiled regex patterns for template directives
static IF_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{if\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}").expect("Invalid if regex")
});

static ELSE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{else\}\}").expect("Invalid else regex")
});

static ENDIF_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{endif\}\}").expect("Invalid endif regex")
});

static FOR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{for\s+([a-z_][a-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
        .expect("Invalid for regex")
});

static ENDFOR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{endfor\}\}").expect("Invalid endfor regex")
});

/// Regex for extracting template variables from content (for variable detection)
static TEMPLATE_VAR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\{\{(?:if|for\s+[a-z_][a-z0-9_]*\s+in)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
        .expect("Invalid template var regex")
});

/// Check if a variable is truthy.
/// A variable is truthy if it exists, is non-empty, is not "false", and is not "0".
fn is_truthy(variables: &HashMap<String, String>, var_name: &str) -> bool {
    let key = format!("%{}%", var_name);
    match variables.get(&key) {
        Some(value) => {
            let trimmed = value.trim().to_lowercase();
            !trimmed.is_empty() && trimmed != "false" && trimmed != "0"
        }
        None => false,
    }
}

/// Get a variable's value as a list (split by comma).
fn get_list(variables: &HashMap<String, String>, var_name: &str) -> Vec<String> {
    let key = format!("%{}%", var_name);
    match variables.get(&key) {
        Some(value) => value
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        None => Vec::new(),
    }
}

/// Process template directives in content.
///
/// Processing order:
/// 1. Process `{{for}}` loops first (expands iterations)
/// 2. Process `{{if}}` conditionals second
///
/// Note: Standard `%VAR%` substitution should be done separately after this.
pub fn process_template(
    content: &str,
    variables: &HashMap<String, String>,
) -> Result<String, TemplateError> {
    // Process for loops first (they may contain if blocks)
    let after_for = process_for_loops(content, variables, 0)?;
    // Then process if conditionals
    process_if_conditionals(&after_for, variables, 0)
}

/// Process all {{for}} loops in the content
fn process_for_loops(
    content: &str,
    variables: &HashMap<String, String>,
    depth: usize,
) -> Result<String, TemplateError> {
    if depth > MAX_NESTING_DEPTH {
        return Err(TemplateError::MaxDepthExceeded);
    }

    let mut result = content.to_string();

    // Keep processing until no more for loops are found
    // Process innermost loops first (by finding loops that don't contain other loops)
    loop {
        // Find the first for loop
        let for_match = FOR_REGEX.find(&result);
        if for_match.is_none() {
            break;
        }

        let for_match = for_match.unwrap();
        let for_start = for_match.start();
        let for_end = for_match.end();

        // Extract the loop variable and source variable
        let captures = FOR_REGEX.captures(&result[for_start..]).unwrap();
        let item_var = captures.get(1).unwrap().as_str().to_string();
        let source_var = captures.get(2).unwrap().as_str().to_string();

        // Find the matching endfor
        let remaining = &result[for_end..];
        let endfor_pos = find_matching_endfor(remaining)?;
        let block_content = &remaining[..endfor_pos];
        let endfor_end = for_end + endfor_pos + "{{endfor}}".len();

        // Get the list items
        let items = get_list(variables, &source_var);

        // Expand the loop
        let mut expanded = String::new();
        for item_value in items {
            let mut iteration = block_content.to_string();
            // Replace {{item_var}} with the item value
            let item_pattern = format!("{{{{{}}}}}", item_var);
            iteration = iteration.replace(&item_pattern, &item_value);
            expanded.push_str(&iteration);
        }

        // Replace the entire for block with the expanded content
        result = format!("{}{}{}", &result[..for_start], expanded, &result[endfor_end..]);
    }

    // Check for orphan endfor
    if ENDFOR_REGEX.is_match(&result) {
        return Err(TemplateError::UnexpectedEndfor);
    }

    Ok(result)
}

/// Find the position of the matching {{endfor}} for a {{for}} block.
/// Handles nested for loops.
fn find_matching_endfor(content: &str) -> Result<usize, TemplateError> {
    let mut depth = 1;
    let mut pos = 0;

    while pos < content.len() {
        // Check for nested for
        if let Some(m) = FOR_REGEX.find(&content[pos..]) {
            if let Some(e) = ENDFOR_REGEX.find(&content[pos..]) {
                if m.start() < e.start() {
                    // Found a nested for before endfor
                    depth += 1;
                    pos += m.end();
                    continue;
                }
            }
        }

        // Check for endfor
        if let Some(m) = ENDFOR_REGEX.find(&content[pos..]) {
            depth -= 1;
            if depth == 0 {
                return Ok(pos + m.start());
            }
            pos += m.end();
        } else {
            // No more endfor found
            break;
        }
    }

    Err(TemplateError::UnclosedFor {
        var: "unknown".to_string(),
        item: "unknown".to_string(),
    })
}

/// Process all {{if}} conditionals in the content
fn process_if_conditionals(
    content: &str,
    variables: &HashMap<String, String>,
    depth: usize,
) -> Result<String, TemplateError> {
    if depth > MAX_NESTING_DEPTH {
        return Err(TemplateError::MaxDepthExceeded);
    }

    let mut result = content.to_string();

    // Keep processing until no more if blocks are found
    loop {
        // Find the first if block
        let if_match = IF_REGEX.find(&result);
        if if_match.is_none() {
            break;
        }

        let if_match = if_match.unwrap();
        let if_start = if_match.start();
        let if_end = if_match.end();

        // Extract the condition variable
        let captures = IF_REGEX.captures(&result[if_start..]).unwrap();
        let condition_var = captures.get(1).unwrap().as_str().to_string();

        // Find the matching endif (and optional else)
        let remaining = &result[if_end..];
        let (then_content, else_content, block_end) = find_if_block_parts(remaining)?;
        let endif_end = if_end + block_end;

        // Evaluate the condition
        let condition_result = is_truthy(variables, &condition_var);

        // Choose the appropriate content
        let chosen_content = if condition_result {
            then_content
        } else {
            else_content.unwrap_or_default()
        };

        // Replace the entire if block with the chosen content
        result = format!("{}{}{}", &result[..if_start], chosen_content, &result[endif_end..]);
    }

    // Check for orphan endif/else
    if ENDIF_REGEX.is_match(&result) {
        return Err(TemplateError::UnexpectedEndif);
    }
    if ELSE_REGEX.is_match(&result) {
        return Err(TemplateError::UnexpectedElse);
    }

    Ok(result)
}

/// Find the parts of an if block: then content, optional else content, and end position.
/// Returns (then_content, else_content, end_position_after_endif)
fn find_if_block_parts(content: &str) -> Result<(String, Option<String>, usize), TemplateError> {
    let mut depth = 1;
    let mut pos = 0;
    let mut else_pos: Option<usize> = None;

    while pos < content.len() {
        let remaining = &content[pos..];

        // Find next relevant token
        let next_if = IF_REGEX.find(remaining).map(|m| (m.start(), "if"));
        let next_else = ELSE_REGEX.find(remaining).map(|m| (m.start(), "else"));
        let next_endif = ENDIF_REGEX.find(remaining).map(|m| (m.start(), "endif"));

        // Find the earliest token
        let mut tokens: Vec<(usize, &str)> = Vec::new();
        if let Some(t) = next_if { tokens.push(t); }
        if let Some(t) = next_else { tokens.push(t); }
        if let Some(t) = next_endif { tokens.push(t); }

        if tokens.is_empty() {
            break;
        }

        tokens.sort_by_key(|t| t.0);
        let (offset, token_type) = tokens[0];

        match token_type {
            "if" => {
                depth += 1;
                let m = IF_REGEX.find(remaining).unwrap();
                pos += m.end();
            }
            "else" => {
                if depth == 1 && else_pos.is_none() {
                    else_pos = Some(pos + offset);
                }
                let m = ELSE_REGEX.find(remaining).unwrap();
                pos += m.end();
            }
            "endif" => {
                depth -= 1;
                if depth == 0 {
                    let endif_match = ENDIF_REGEX.find(remaining).unwrap();
                    let endif_start = pos + endif_match.start();
                    let endif_end = pos + endif_match.end();

                    return if let Some(else_start) = else_pos {
                        let then_content = content[..else_start].to_string();
                        let else_content_start = else_start + "{{else}}".len();
                        let else_content = content[else_content_start..endif_start].to_string();
                        Ok((then_content, Some(else_content), endif_end))
                    } else {
                        let then_content = content[..endif_start].to_string();
                        Ok((then_content, None, endif_end))
                    };
                }
                let m = ENDIF_REGEX.find(remaining).unwrap();
                pos += m.end();
            }
            _ => unreachable!(),
        }
    }

    Err(TemplateError::UnclosedIf {
        var: "unknown".to_string(),
    })
}

/// Extract variable names used in template directives.
/// Returns uppercase variable names (without % delimiters) used in {{if VAR}} and {{for item in VAR}}.
pub fn extract_template_variables(content: &str) -> Vec<String> {
    let mut vars = HashSet::new();

    for cap in TEMPLATE_VAR_REGEX.captures_iter(content) {
        if let Some(var) = cap.get(1) {
            let var_name = var.as_str();
            // Only include uppercase variables
            if var_name.chars().all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit()) {
                vars.insert(format!("%{}%", var_name));
            }
        }
    }

    vars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // ========================================================================
    // Truthiness Tests
    // ========================================================================

    #[test]
    fn test_is_truthy_exists_and_non_empty() {
        let vars = make_vars(&[("%FLAG%", "yes")]);
        assert!(is_truthy(&vars, "FLAG"));
    }

    #[test]
    fn test_is_truthy_false_string() {
        let vars = make_vars(&[("%FLAG%", "false")]);
        assert!(!is_truthy(&vars, "FLAG"));
    }

    #[test]
    fn test_is_truthy_zero_string() {
        let vars = make_vars(&[("%FLAG%", "0")]);
        assert!(!is_truthy(&vars, "FLAG"));
    }

    #[test]
    fn test_is_truthy_empty_string() {
        let vars = make_vars(&[("%FLAG%", "")]);
        assert!(!is_truthy(&vars, "FLAG"));
    }

    #[test]
    fn test_is_truthy_whitespace_only() {
        let vars = make_vars(&[("%FLAG%", "   ")]);
        assert!(!is_truthy(&vars, "FLAG"));
    }

    #[test]
    fn test_is_truthy_missing_variable() {
        let vars = make_vars(&[]);
        assert!(!is_truthy(&vars, "FLAG"));
    }

    #[test]
    fn test_is_truthy_case_insensitive_false() {
        let vars = make_vars(&[("%FLAG%", "FALSE")]);
        assert!(!is_truthy(&vars, "FLAG"));

        let vars2 = make_vars(&[("%FLAG%", "False")]);
        assert!(!is_truthy(&vars2, "FLAG"));
    }

    // ========================================================================
    // If/Else Tests
    // ========================================================================

    #[test]
    fn test_simple_if_true() {
        let vars = make_vars(&[("%SHOW%", "true")]);
        let content = "before\n{{if SHOW}}included{{endif}}\nafter";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "before\nincluded\nafter");
    }

    #[test]
    fn test_simple_if_false() {
        let vars = make_vars(&[("%SHOW%", "false")]);
        let content = "before\n{{if SHOW}}excluded{{endif}}\nafter";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "before\n\nafter");
    }

    #[test]
    fn test_if_else_true() {
        let vars = make_vars(&[("%SHOW%", "yes")]);
        let content = "{{if SHOW}}then-branch{{else}}else-branch{{endif}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "then-branch");
    }

    #[test]
    fn test_if_else_false() {
        let vars = make_vars(&[("%SHOW%", "0")]);
        let content = "{{if SHOW}}then-branch{{else}}else-branch{{endif}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "else-branch");
    }

    #[test]
    fn test_nested_if() {
        let vars = make_vars(&[("%A%", "true"), ("%B%", "true")]);
        let content = "{{if A}}A{{if B}}B{{endif}}{{endif}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "AB");
    }

    #[test]
    fn test_nested_if_inner_false() {
        let vars = make_vars(&[("%A%", "true"), ("%B%", "false")]);
        let content = "{{if A}}A{{if B}}B{{endif}}{{endif}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "A");
    }

    #[test]
    fn test_unclosed_if_error() {
        let vars = make_vars(&[]);
        let content = "{{if SHOW}}no end";
        let result = process_template(content, &vars);
        assert!(matches!(result, Err(TemplateError::UnclosedIf { .. })));
    }

    #[test]
    fn test_unexpected_endif_error() {
        let vars = make_vars(&[]);
        let content = "random {{endif}}";
        let result = process_template(content, &vars);
        assert!(matches!(result, Err(TemplateError::UnexpectedEndif)));
    }

    #[test]
    fn test_unexpected_else_error() {
        let vars = make_vars(&[]);
        let content = "random {{else}}";
        let result = process_template(content, &vars);
        assert!(matches!(result, Err(TemplateError::UnexpectedElse)));
    }

    // ========================================================================
    // For Loop Tests
    // ========================================================================

    #[test]
    fn test_simple_for_loop() {
        let vars = make_vars(&[("%ITEMS%", "a,b,c")]);
        let content = "{{for item in ITEMS}}[{{item}}]{{endfor}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "[a][b][c]");
    }

    #[test]
    fn test_for_loop_empty_list() {
        let vars = make_vars(&[("%ITEMS%", "")]);
        let content = "before{{for item in ITEMS}}[{{item}}]{{endfor}}after";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "beforeafter");
    }

    #[test]
    fn test_for_loop_missing_variable() {
        let vars = make_vars(&[]);
        let content = "{{for x in MISSING}}[{{x}}]{{endfor}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_for_loop_with_whitespace_items() {
        let vars = make_vars(&[("%ITEMS%", " a , b , c ")]);
        let content = "{{for item in ITEMS}}[{{item}}]{{endfor}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "[a][b][c]");
    }

    #[test]
    fn test_nested_for_loops() {
        let vars = make_vars(&[("%OUTER%", "1,2"), ("%INNER%", "a,b")]);
        let content = "{{for i in OUTER}}{{for j in INNER}}({{i}},{{j}}){{endfor}}{{endfor}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "(1,a)(1,b)(2,a)(2,b)");
    }

    #[test]
    fn test_unclosed_for_error() {
        let vars = make_vars(&[]);
        let content = "{{for x in ITEMS}}no end";
        let result = process_template(content, &vars);
        assert!(matches!(result, Err(TemplateError::UnclosedFor { .. })));
    }

    #[test]
    fn test_unexpected_endfor_error() {
        let vars = make_vars(&[]);
        let content = "random {{endfor}}";
        let result = process_template(content, &vars);
        assert!(matches!(result, Err(TemplateError::UnexpectedEndfor)));
    }

    // ========================================================================
    // Combined If/For Tests
    // ========================================================================

    #[test]
    fn test_if_inside_for() {
        let vars = make_vars(&[("%ITEMS%", "a,b,c"), ("%SHOW_B%", "true")]);
        let content = "{{for item in ITEMS}}{{if SHOW_B}}[{{item}}]{{endif}}{{endfor}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "[a][b][c]");
    }

    #[test]
    fn test_for_inside_if() {
        let vars = make_vars(&[("%SHOW%", "true"), ("%ITEMS%", "x,y")]);
        let content = "{{if SHOW}}{{for i in ITEMS}}{{i}}{{endfor}}{{endif}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "xy");
    }

    #[test]
    fn test_for_inside_if_false() {
        let vars = make_vars(&[("%SHOW%", "false"), ("%ITEMS%", "x,y")]);
        let content = "{{if SHOW}}{{for i in ITEMS}}{{i}}{{endfor}}{{endif}}";
        let result = process_template(content, &vars).unwrap();
        assert_eq!(result, "");
    }

    // ========================================================================
    // Variable Extraction Tests
    // ========================================================================

    #[test]
    fn test_extract_if_variable() {
        let content = "{{if USE_FEATURE}}feature{{endif}}";
        let vars = extract_template_variables(content);
        assert!(vars.contains(&"%USE_FEATURE%".to_string()));
    }

    #[test]
    fn test_extract_for_variable() {
        let content = "{{for item in ITEMS}}{{item}}{{endfor}}";
        let vars = extract_template_variables(content);
        assert!(vars.contains(&"%ITEMS%".to_string()));
    }

    #[test]
    fn test_extract_ignores_lowercase_variables() {
        // Lowercase condition variables should be ignored
        let content = "{{if lowercase}}test{{endif}}";
        let vars = extract_template_variables(content);
        assert!(vars.is_empty());
    }

    #[test]
    fn test_extract_multiple_variables() {
        let content = "{{if A}}a{{endif}}{{if B}}b{{endif}}{{for x in C}}{{x}}{{endfor}}";
        let vars = extract_template_variables(content);
        assert!(vars.contains(&"%A%".to_string()));
        assert!(vars.contains(&"%B%".to_string()));
        assert!(vars.contains(&"%C%".to_string()));
    }

    // ========================================================================
    // Real-World Examples
    // ========================================================================

    #[test]
    fn test_readme_example() {
        let vars = make_vars(&[
            ("%USE_NPM%", "false"),
            ("%FEATURES%", "auth,api,ui"),
        ]);
        let content = r#"# Project

{{if USE_NPM}}
npm install
{{else}}
yarn install
{{endif}}

## Features
{{for feature in FEATURES}}
- {{feature}}
{{endfor}}
"#;
        let result = process_template(content, &vars).unwrap();
        assert!(result.contains("yarn install"));
        assert!(!result.contains("npm install"));
        assert!(result.contains("- auth"));
        assert!(result.contains("- api"));
        assert!(result.contains("- ui"));
    }

    #[test]
    fn test_multiline_blocks() {
        let vars = make_vars(&[("%INCLUDE_TESTS%", "true")]);
        let content = r#"// main code
{{if INCLUDE_TESTS}}
describe('test suite', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
{{endif}}
// more code"#;
        let result = process_template(content, &vars).unwrap();
        assert!(result.contains("describe('test suite'"));
        assert!(result.contains("// main code"));
        assert!(result.contains("// more code"));
    }

    #[test]
    fn test_no_template_directives() {
        let vars = make_vars(&[]);
        let content = "This is {{just}} some text with {curly} braces";
        let result = process_template(content, &vars).unwrap();
        // Content should be unchanged since {{just}} isn't a valid directive
        assert_eq!(result, "This is {{just}} some text with {curly} braces");
    }

    #[test]
    fn test_preserves_handlebars_syntax() {
        // This tests that non-template {{}} patterns are preserved
        let vars = make_vars(&[("%SHOW%", "true")]);
        let content = "{{> header}}{{if SHOW}}included{{endif}}{{> footer}}";
        let result = process_template(content, &vars).unwrap();
        assert!(result.contains("{{> header}}"));
        assert!(result.contains("{{> footer}}"));
        assert!(result.contains("included"));
    }
}
