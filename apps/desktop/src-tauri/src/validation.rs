//! Schema validation module for Structure Creator.
//!
//! Provides comprehensive schema validation that runs before structure creation,
//! catching errors early and providing clear feedback to users.
//!
//! ## Validation Checks
//!
//! | Check | Severity | Notes |
//! |-------|----------|-------|
//! | XML syntax errors | Error | Blocks creation |
//! | Undefined variable references | Warning | Advisory - user may intend to add value |
//! | Duplicate sibling names | Warning | May be intentional in if/else branches |
//! | Circular template inheritance | Error | Already implemented, needs surfacing |
//! | Invalid URL format | Warning | Syntax check only (no network requests) |

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use url::Url;

use crate::schema::{parse_xml_schema, resolve_template_inheritance, SchemaNode, SchemaTree, TemplateData};
use crate::transforms::find_variable_refs;

/// Severity level for validation issues
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ValidationSeverity {
    Error,
    Warning,
}

/// Type of validation issue
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ValidationIssueType {
    XmlSyntax,
    UndefinedVariable,
    DuplicateName,
    CircularInheritance,
    InheritanceError,
    InvalidUrl,
}

/// A single validation issue found in the schema
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub severity: ValidationSeverity,
    pub issue_type: ValidationIssueType,
    pub message: String,
    /// Path to the node where the issue was found (e.g., "root/src/components")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_path: Option<String>,
    /// The problematic value (e.g., the undefined variable name or invalid URL)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// Result of schema validation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaValidationResult {
    /// True if no errors were found (warnings don't affect this)
    pub is_valid: bool,
    /// Error-level issues that block creation
    pub errors: Vec<ValidationIssue>,
    /// Warning-level issues that are advisory
    pub warnings: Vec<ValidationIssue>,
}

impl SchemaValidationResult {
    pub fn new() -> Self {
        Self {
            is_valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    pub fn add_error(&mut self, issue: ValidationIssue) {
        self.is_valid = false;
        self.errors.push(issue);
    }

    pub fn add_warning(&mut self, issue: ValidationIssue) {
        self.warnings.push(issue);
    }

    pub fn merge(&mut self, other: SchemaValidationResult) {
        if !other.is_valid {
            self.is_valid = false;
        }
        self.errors.extend(other.errors);
        self.warnings.extend(other.warnings);
    }
}

impl Default for SchemaValidationResult {
    fn default() -> Self {
        Self::new()
    }
}

/// Validate XML syntax by attempting to parse the schema.
/// Returns the validation result and the parsed tree (if successful).
pub fn validate_xml_syntax(content: &str) -> (SchemaValidationResult, Option<SchemaTree>) {
    let mut result = SchemaValidationResult::new();

    match parse_xml_schema(content) {
        Ok(tree) => (result, Some(tree)),
        Err(e) => {
            result.add_error(ValidationIssue {
                severity: ValidationSeverity::Error,
                issue_type: ValidationIssueType::XmlSyntax,
                message: format!("XML syntax error: {}", e),
                node_path: None,
                value: None,
            });
            (result, None)
        }
    }
}

/// Check for undefined variable references in the schema.
/// Uses find_variable_refs from transforms.rs to find all %VAR% patterns
/// and compares against provided variables.
pub fn check_undefined_variables(
    content: &str,
    variables: &HashMap<String, String>,
) -> SchemaValidationResult {
    let mut result = SchemaValidationResult::new();

    // Find all variable references in the content
    let refs = find_variable_refs(content);

    // Check each reference against provided variables
    for var_ref in refs {
        // base_name is already in %NAME% format
        if !variables.contains_key(&var_ref.base_name) {
            // Special case: skip built-in variables as they're handled internally
            if matches!(
                var_ref.base_name.as_str(),
                "%DATE%" | "%YEAR%" | "%MONTH%" | "%DAY%" | "%PROJECT_NAME%"
            ) {
                continue;
            }

            result.add_warning(ValidationIssue {
                severity: ValidationSeverity::Warning,
                issue_type: ValidationIssueType::UndefinedVariable,
                message: format!(
                    "Variable {} is referenced but not defined",
                    var_ref.base_name
                ),
                node_path: None,
                value: Some(var_ref.base_name.clone()),
            });
        }
    }

    result
}

/// Check for duplicate sibling names within the schema tree.
/// Skips if/else/repeat nodes as their children may intentionally have duplicates
/// across different conditional branches.
pub fn check_duplicate_names(node: &SchemaNode) -> SchemaValidationResult {
    let mut result = SchemaValidationResult::new();
    check_duplicate_names_recursive(node, "", &mut result);
    result
}

fn check_duplicate_names_recursive(
    node: &SchemaNode,
    parent_path: &str,
    result: &mut SchemaValidationResult,
) {
    let current_path = if parent_path.is_empty() {
        node.name.clone()
    } else {
        format!("{}/{}", parent_path, node.name)
    };

    if let Some(children) = &node.children {
        // Track names seen at this level
        let mut seen_names: HashMap<String, usize> = HashMap::new();

        for child in children {
            // Skip checking duplicates for control flow nodes (if/else/repeat)
            // as they may intentionally have children with same names in different branches
            if matches!(child.node_type.as_str(), "if" | "else" | "repeat") {
                // Still recurse into control flow nodes to check their children
                check_duplicate_names_recursive(child, &current_path, result);
                continue;
            }

            // Check for duplicate names among non-control-flow siblings
            let count = seen_names.entry(child.name.clone()).or_insert(0);
            *count += 1;

            if *count == 2 {
                // Only warn on the second occurrence
                result.add_warning(ValidationIssue {
                    severity: ValidationSeverity::Warning,
                    issue_type: ValidationIssueType::DuplicateName,
                    message: format!(
                        "Duplicate name '{}' found in {}",
                        child.name, current_path
                    ),
                    node_path: Some(current_path.clone()),
                    value: Some(child.name.clone()),
                });
            }

            // Recurse into child nodes
            check_duplicate_names_recursive(child, &current_path, result);
        }
    }
}

/// Check for template inheritance errors including circular dependencies.
/// Wraps the existing resolve_template_inheritance function and converts
/// InheritanceError to ValidationIssue.
pub fn check_inheritance<F>(
    content: &str,
    template_loader: &F,
) -> SchemaValidationResult
where
    F: Fn(&str) -> Option<TemplateData>,
{
    let mut result = SchemaValidationResult::new();

    if let Err(e) = resolve_template_inheritance(content, template_loader) {
        let message = e.to_string();

        // Determine issue type based on error message
        let issue_type = if message.contains("Circular") {
            ValidationIssueType::CircularInheritance
        } else {
            // Template not found, max depth exceeded, parse error, etc.
            ValidationIssueType::InheritanceError
        };

        result.add_error(ValidationIssue {
            severity: ValidationSeverity::Error,
            issue_type,
            message,
            node_path: None,
            value: None,
        });
    }

    result
}

/// Validate URLs in the schema tree.
/// Performs format validation only (no network requests).
pub fn validate_urls(node: &SchemaNode) -> SchemaValidationResult {
    let mut result = SchemaValidationResult::new();
    validate_urls_recursive(node, "", &mut result);
    result
}

fn validate_urls_recursive(
    node: &SchemaNode,
    parent_path: &str,
    result: &mut SchemaValidationResult,
) {
    let current_path = if parent_path.is_empty() {
        node.name.clone()
    } else {
        format!("{}/{}", parent_path, node.name)
    };

    // Check URL if present and doesn't contain variables (which can't be validated statically)
    if let Some(url_str) = &node.url {
        if !url_str.contains('%') {
            if let Err(e) = Url::parse(url_str) {
                result.add_warning(ValidationIssue {
                    severity: ValidationSeverity::Warning,
                    issue_type: ValidationIssueType::InvalidUrl,
                    message: format!("Invalid URL format: {}", e),
                    node_path: Some(current_path.clone()),
                    value: Some(url_str.clone()),
                });
            }
        }
    }

    // Recurse into children
    if let Some(children) = &node.children {
        for child in children {
            validate_urls_recursive(child, &current_path, result);
        }
    }
}

/// Run all validation checks on a schema.
///
/// # Arguments
/// * `content` - The XML schema content to validate
/// * `variables` - Map of variable names (with % delimiters) to their values
/// * `template_loader` - Optional function to load templates by name for inheritance checks
///
/// # Returns
/// A SchemaValidationResult containing all errors and warnings found
pub fn validate_schema<F>(
    content: &str,
    variables: &HashMap<String, String>,
    template_loader: Option<&F>,
) -> SchemaValidationResult
where
    F: Fn(&str) -> Option<TemplateData>,
{
    let mut result = SchemaValidationResult::new();

    // 1. Validate XML syntax first and get the parsed tree
    let (syntax_result, parsed_tree) = validate_xml_syntax(content);
    if !syntax_result.is_valid {
        return syntax_result;
    }

    // 2. Check for undefined variables
    let vars_result = check_undefined_variables(content, variables);
    result.merge(vars_result);

    // 3. Check structural issues using the already-parsed tree
    if let Some(tree) = parsed_tree {
        // 4. Check for duplicate sibling names
        let dup_result = check_duplicate_names(&tree.root);
        result.merge(dup_result);

        // 5. Validate URLs
        let url_result = validate_urls(&tree.root);
        result.merge(url_result);
    }

    // 6. Check inheritance errors if a template loader is provided
    if let Some(loader) = template_loader {
        let inheritance_result = check_inheritance(content, loader);
        result.merge(inheritance_result);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_xml_syntax_valid() {
        let xml = r#"<folder name="test"><file name="readme.txt" /></folder>"#;
        let (result, tree) = validate_xml_syntax(xml);
        assert!(result.is_valid);
        assert!(result.errors.is_empty());
        assert!(tree.is_some());
    }

    #[test]
    fn test_validate_xml_syntax_invalid() {
        let xml = r#"<folder name="test"><file name="readme.txt"</folder>"#;
        let (result, tree) = validate_xml_syntax(xml);
        assert!(!result.is_valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].issue_type, ValidationIssueType::XmlSyntax);
        assert!(tree.is_none());
    }

    #[test]
    fn test_validate_xml_syntax_unclosed_tag() {
        let xml = r#"<folder name="test">"#;
        let (result, tree) = validate_xml_syntax(xml);
        assert!(!result.is_valid);
        assert!(tree.is_none());
    }

    #[test]
    fn test_check_undefined_variables_all_defined() {
        let content = r#"<folder name="%PROJECT%"><file name="%NAME%.txt" /></folder>"#;
        let mut variables = HashMap::new();
        variables.insert("%PROJECT%".to_string(), "my-project".to_string());
        variables.insert("%NAME%".to_string(), "readme".to_string());

        let result = check_undefined_variables(content, &variables);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_check_undefined_variables_missing() {
        let content = r#"<folder name="%PROJECT%"><file name="%UNDEFINED%.txt" /></folder>"#;
        let mut variables = HashMap::new();
        variables.insert("%PROJECT%".to_string(), "my-project".to_string());

        let result = check_undefined_variables(content, &variables);
        assert!(result.is_valid); // Warnings don't affect validity
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(
            result.warnings[0].issue_type,
            ValidationIssueType::UndefinedVariable
        );
        assert_eq!(result.warnings[0].value, Some("%UNDEFINED%".to_string()));
    }

    #[test]
    fn test_check_undefined_variables_with_transform() {
        let content = r#"<folder name="%NAME:uppercase%"><file name="%NAME:kebab-case%.txt" /></folder>"#;
        let mut variables = HashMap::new();
        variables.insert("%NAME%".to_string(), "MyProject".to_string());

        let result = check_undefined_variables(content, &variables);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_check_undefined_variables_date_special() {
        // DATE is a special variable that's handled internally
        let content = r#"<file name="%DATE:format(YYYY-MM-DD)%.txt" />"#;
        let variables = HashMap::new();

        let result = check_undefined_variables(content, &variables);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_check_undefined_variables_year_month_day_special() {
        // YEAR, MONTH, DAY are built-in variables handled internally
        let content = r#"<file name="report-%YEAR%-%MONTH%-%DAY%.txt" />"#;
        let variables = HashMap::new();

        let result = check_undefined_variables(content, &variables);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_check_duplicate_names_no_duplicates() {
        let node = SchemaNode {
            id: None,
            node_type: "folder".to_string(),
            name: "root".to_string(),
            url: None,
            content: None,
            children: Some(vec![
                SchemaNode {
                    id: None,
                    node_type: "file".to_string(),
                    name: "file1.txt".to_string(),
                    url: None,
                    content: None,
                    children: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                },
                SchemaNode {
                    id: None,
                    node_type: "file".to_string(),
                    name: "file2.txt".to_string(),
                    url: None,
                    content: None,
                    children: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                },
            ]),
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
        };

        let result = check_duplicate_names(&node);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_check_duplicate_names_with_duplicates() {
        let node = SchemaNode {
            id: None,
            node_type: "folder".to_string(),
            name: "root".to_string(),
            url: None,
            content: None,
            children: Some(vec![
                SchemaNode {
                    id: None,
                    node_type: "file".to_string(),
                    name: "readme.txt".to_string(),
                    url: None,
                    content: None,
                    children: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                },
                SchemaNode {
                    id: None,
                    node_type: "file".to_string(),
                    name: "readme.txt".to_string(), // Duplicate!
                    url: None,
                    content: None,
                    children: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                },
            ]),
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
        };

        let result = check_duplicate_names(&node);
        assert!(result.is_valid); // Warnings don't affect validity
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(
            result.warnings[0].issue_type,
            ValidationIssueType::DuplicateName
        );
    }

    #[test]
    fn test_check_duplicate_names_in_if_else_branches() {
        // Duplicates inside if/else branches should NOT be flagged
        // because only one branch will execute
        let node = SchemaNode {
            id: None,
            node_type: "folder".to_string(),
            name: "root".to_string(),
            url: None,
            content: None,
            children: Some(vec![
                SchemaNode {
                    id: None,
                    node_type: "if".to_string(),
                    name: "".to_string(),
                    url: None,
                    content: None,
                    children: Some(vec![SchemaNode {
                        id: None,
                        node_type: "file".to_string(),
                        name: "config.json".to_string(),
                        url: None,
                        content: None,
                        children: None,
                        condition_var: None,
                        repeat_count: None,
                        repeat_as: None,
                    }]),
                    condition_var: Some("USE_JSON".to_string()),
                    repeat_count: None,
                    repeat_as: None,
                },
                SchemaNode {
                    id: None,
                    node_type: "else".to_string(),
                    name: "".to_string(),
                    url: None,
                    content: None,
                    children: Some(vec![SchemaNode {
                        id: None,
                        node_type: "file".to_string(),
                        name: "config.json".to_string(), // Same name but in else branch - OK
                        url: None,
                        content: None,
                        children: None,
                        condition_var: None,
                        repeat_count: None,
                        repeat_as: None,
                    }]),
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                },
            ]),
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
        };

        let result = check_duplicate_names(&node);
        assert!(result.is_valid);
        // The if and else blocks themselves are skipped for duplicate checking,
        // and their children are in separate branches
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validate_urls_valid() {
        let node = SchemaNode {
            id: None,
            node_type: "folder".to_string(),
            name: "root".to_string(),
            url: None,
            content: None,
            children: Some(vec![SchemaNode {
                id: None,
                node_type: "file".to_string(),
                name: "gitignore".to_string(),
                url: Some("https://example.com/gitignore".to_string()),
                content: None,
                children: None,
                condition_var: None,
                repeat_count: None,
                repeat_as: None,
            }]),
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
        };

        let result = validate_urls(&node);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validate_urls_invalid() {
        let node = SchemaNode {
            id: None,
            node_type: "folder".to_string(),
            name: "root".to_string(),
            url: None,
            content: None,
            children: Some(vec![SchemaNode {
                id: None,
                node_type: "file".to_string(),
                name: "gitignore".to_string(),
                url: Some("not-a-valid-url".to_string()),
                content: None,
                children: None,
                condition_var: None,
                repeat_count: None,
                repeat_as: None,
            }]),
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
        };

        let result = validate_urls(&node);
        assert!(result.is_valid); // Warnings don't affect validity
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].issue_type, ValidationIssueType::InvalidUrl);
    }

    #[test]
    fn test_validate_urls_with_variables_skipped() {
        // URLs containing variables should be skipped
        let node = SchemaNode {
            id: None,
            node_type: "file".to_string(),
            name: "config".to_string(),
            url: Some("https://example.com/%CONFIG_FILE%".to_string()),
            content: None,
            children: None,
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
        };

        let result = validate_urls(&node);
        assert!(result.is_valid);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_check_inheritance_no_extends() {
        let content = r#"<folder name="project"><file name="readme.txt" /></folder>"#;

        let loader = |_name: &str| -> Option<TemplateData> { None };

        let result = check_inheritance(content, &loader);
        assert!(result.is_valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_check_inheritance_circular() {
        let template_a = r#"<template extends="template-b"><file name="a.txt" /></template>"#;
        let template_b = r#"<template extends="template-a"><file name="b.txt" /></template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            match name {
                "template-a" => Some(TemplateData {
                    schema_xml: template_a.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                "template-b" => Some(TemplateData {
                    schema_xml: template_b.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                _ => None,
            }
        };

        let result = check_inheritance(template_a, &loader);
        assert!(!result.is_valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(
            result.errors[0].issue_type,
            ValidationIssueType::CircularInheritance
        );
    }

    #[test]
    fn test_check_inheritance_template_not_found() {
        let content = r#"<template extends="nonexistent-template"><file name="a.txt" /></template>"#;

        let loader = |_name: &str| -> Option<TemplateData> { None };

        let result = check_inheritance(content, &loader);
        assert!(!result.is_valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(
            result.errors[0].issue_type,
            ValidationIssueType::InheritanceError
        );
        assert!(result.errors[0].message.contains("not found"));
    }

    #[test]
    fn test_validate_schema_all_checks() {
        let content = r#"<folder name="%PROJECT%">
            <file name="%NAME%.txt" />
            <file name="config.json" url="https://example.com/config" />
        </folder>"#;

        let mut variables = HashMap::new();
        variables.insert("%PROJECT%".to_string(), "my-project".to_string());
        variables.insert("%NAME%".to_string(), "readme".to_string());

        let loader = |_name: &str| -> Option<TemplateData> { None };

        let result = validate_schema(content, &variables, Some(&loader));
        assert!(result.is_valid);
        assert!(result.errors.is_empty());
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_validate_schema_with_issues() {
        let content = r#"<folder name="%PROJECT%">
            <file name="%UNDEFINED%.txt" />
            <file name="config.json" url="invalid-url" />
            <file name="readme.txt" />
            <file name="readme.txt" />
        </folder>"#;

        let mut variables = HashMap::new();
        variables.insert("%PROJECT%".to_string(), "my-project".to_string());

        let loader = |_name: &str| -> Option<TemplateData> { None };

        let result = validate_schema(content, &variables, Some(&loader));
        assert!(result.is_valid); // Only warnings, no errors
        assert!(result.errors.is_empty());
        // Should have warnings for: undefined variable, invalid URL, duplicate name
        assert_eq!(result.warnings.len(), 3);
    }

    #[test]
    fn test_validate_schema_xml_error_returns_early() {
        let content = r#"<folder name="test"><file name="broken"</folder>"#;
        let variables = HashMap::new();
        let loader = |_name: &str| -> Option<TemplateData> { None };

        let result = validate_schema(content, &variables, Some(&loader));
        assert!(!result.is_valid);
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].issue_type, ValidationIssueType::XmlSyntax);
        // Should return early without running other checks
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn test_schema_validation_result_merge() {
        let mut result1 = SchemaValidationResult::new();
        result1.add_warning(ValidationIssue {
            severity: ValidationSeverity::Warning,
            issue_type: ValidationIssueType::UndefinedVariable,
            message: "Test warning".to_string(),
            node_path: None,
            value: None,
        });

        let mut result2 = SchemaValidationResult::new();
        result2.add_error(ValidationIssue {
            severity: ValidationSeverity::Error,
            issue_type: ValidationIssueType::XmlSyntax,
            message: "Test error".to_string(),
            node_path: None,
            value: None,
        });

        result1.merge(result2);

        assert!(!result1.is_valid);
        assert_eq!(result1.errors.len(), 1);
        assert_eq!(result1.warnings.len(), 1);
    }
}
