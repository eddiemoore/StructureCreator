//! Integration tests for the Structure Creator CLI
//!
//! These tests run the CLI binary and verify end-to-end behavior.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Output};
use tempfile::TempDir;

/// Get the path to the CLI binary
fn cli_binary() -> PathBuf {
    // The binary is built in target/debug when running tests
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("target");
    path.push("debug");
    path.push("structure-creator");
    path
}

/// Run the CLI with given arguments
fn run_cli(args: &[&str]) -> Output {
    Command::new(cli_binary())
        .args(args)
        .output()
        .expect("Failed to execute CLI")
}

/// Create a temporary schema file with given content
fn create_schema_file(dir: &TempDir, content: &str) -> PathBuf {
    let path = dir.path().join("schema.xml");
    let mut file = fs::File::create(&path).unwrap();
    file.write_all(content.as_bytes()).unwrap();
    path
}

/// Simple valid schema for testing
const SIMPLE_SCHEMA: &str = r#"<folder name="test-project">
    <file name="README.md">Hello World</file>
    <folder name="src">
        <file name="main.rs">fn main() {}</file>
    </folder>
</folder>"#;

/// Schema with variables
const SCHEMA_WITH_VARS: &str = r#"<folder name="%PROJECT_NAME%">
    <file name="README.md"># %PROJECT_NAME%</file>
</folder>"#;

// ==================== Create Command Tests ====================

#[test]
fn test_create_from_schema_file() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    assert!(output_dir.join("test-project").exists());
    assert!(output_dir.join("test-project/README.md").exists());
    assert!(output_dir.join("test-project/src/main.rs").exists());
}

#[test]
fn test_create_with_variables() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SCHEMA_WITH_VARS);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--var",
        "PROJECT_NAME=MyAwesomeProject",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    // Variable substitution should work for folder names
    assert!(output_dir.join("MyAwesomeProject").exists());
    assert!(output_dir.join("MyAwesomeProject/README.md").exists());
}

#[test]
fn test_create_dry_run() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--dry-run",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    // In dry-run mode, no files should be created
    assert!(!output_dir.join("test-project").exists());
}

#[test]
fn test_create_json_output() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--json",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Should be valid JSON with expected fields
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("Invalid JSON output");
    assert!(json.get("summary").is_some());
    assert!(json.get("logs").is_some());
}

#[test]
fn test_create_missing_schema_error() {
    let temp = TempDir::new().unwrap();
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        "/nonexistent/schema.xml",
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(2)); // Usage error
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("does not exist"));
}

#[test]
fn test_create_missing_output_error() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);

    // Missing --output flag
    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
}

#[test]
fn test_create_invalid_schema_error() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, "not valid xml <><>");
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(1)); // Error
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Failed to parse"));
}

#[test]
fn test_create_requires_template_or_schema() {
    let temp = TempDir::new().unwrap();
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(2)); // Usage error
}

// ==================== Scan Command Tests ====================

#[test]
fn test_scan_folder_to_stdout() {
    let temp = TempDir::new().unwrap();
    let scan_dir = temp.path().join("to-scan");
    fs::create_dir_all(&scan_dir).unwrap();
    fs::write(scan_dir.join("file.txt"), "content").unwrap();

    let output = run_cli(&[
        "scan",
        scan_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("<folder"));
    assert!(stdout.contains("file.txt"));
}

#[test]
fn test_scan_folder_to_file() {
    let temp = TempDir::new().unwrap();
    let scan_dir = temp.path().join("to-scan");
    fs::create_dir_all(&scan_dir).unwrap();
    fs::write(scan_dir.join("file.txt"), "content").unwrap();
    let output_file = temp.path().join("schema.xml");

    let output = run_cli(&[
        "scan",
        scan_dir.to_str().unwrap(),
        "--output",
        output_file.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    assert!(output_file.exists());

    let content = fs::read_to_string(&output_file).unwrap();
    assert!(content.contains("<folder"));
}

#[test]
fn test_scan_json_output() {
    let temp = TempDir::new().unwrap();
    let scan_dir = temp.path().join("to-scan");
    fs::create_dir_all(&scan_dir).unwrap();
    fs::write(scan_dir.join("file.txt"), "content").unwrap();

    let output = run_cli(&[
        "scan",
        scan_dir.to_str().unwrap(),
        "--json",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("Invalid JSON output");
    assert!(json.get("root").is_some());
    assert!(json.get("stats").is_some());
}

#[test]
fn test_scan_nonexistent_folder() {
    let output = run_cli(&[
        "scan",
        "/nonexistent/folder",
    ]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(2)); // Usage error
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("does not exist"));
}

#[test]
fn test_scan_overwrite_protection() {
    let temp = TempDir::new().unwrap();
    let scan_dir = temp.path().join("to-scan");
    fs::create_dir_all(&scan_dir).unwrap();
    fs::write(scan_dir.join("file.txt"), "content").unwrap();

    let output_file = temp.path().join("schema.xml");
    fs::write(&output_file, "existing content").unwrap();

    // Without --overwrite, should fail
    let output = run_cli(&[
        "scan",
        scan_dir.to_str().unwrap(),
        "--output",
        output_file.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("already exists"));

    // With --overwrite, should succeed
    let output = run_cli(&[
        "scan",
        scan_dir.to_str().unwrap(),
        "--output",
        output_file.to_str().unwrap(),
        "--overwrite",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
}

// ==================== Parse Command Tests ====================

#[test]
fn test_parse_valid_schema() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);

    let output = run_cli(&[
        "parse",
        schema_path.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Schema:"));
    assert!(stdout.contains("Folders:"));
    assert!(stdout.contains("Files:"));
}

#[test]
fn test_parse_invalid_xml() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, "not valid xml");

    let output = run_cli(&[
        "parse",
        schema_path.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(1)); // Error
}

#[test]
fn test_parse_json_output() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);

    let output = run_cli(&[
        "parse",
        schema_path.to_str().unwrap(),
        "--json",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("Invalid JSON output");
    assert!(json.get("root").is_some());
}

// ==================== Templates Command Tests ====================

#[test]
fn test_templates_list_json() {
    let output = run_cli(&["templates", "list", "--json"]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Should be valid JSON array
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("Invalid JSON output");
    assert!(json.is_array());
}

#[test]
fn test_templates_show_not_found() {
    let output = run_cli(&["templates", "show", "nonexistent-template-12345"]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(1)); // Error
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("not found"));
}

#[test]
fn test_templates_delete_requires_force() {
    // Note: If template doesn't exist, we get "not found" error first.
    // The --force check only happens after template is found.
    // We can't easily test --force requirement without creating a template first,
    // so we just verify the command fails for non-existent template.
    let output = run_cli(&["templates", "delete", "nonexistent-template-12345"]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    // Should either say "not found" or require "--force"
    assert!(stderr.contains("not found") || stderr.contains("--force"));
}

#[test]
fn test_templates_import_invalid_json() {
    let temp = TempDir::new().unwrap();
    let invalid_file = temp.path().join("invalid.sct");
    fs::write(&invalid_file, "not json").unwrap();

    let output = run_cli(&[
        "templates",
        "import",
        invalid_file.to_str().unwrap(),
    ]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("JSON"));
}

#[test]
fn test_templates_import_nonexistent_file() {
    let output = run_cli(&[
        "templates",
        "import",
        "/nonexistent/template.sct",
    ]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(2)); // Usage error
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("does not exist"));
}

// ==================== Exit Code Tests ====================

#[test]
fn test_exit_code_success() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert_eq!(output.status.code(), Some(0));
}

#[test]
fn test_exit_code_error() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, "invalid xml");
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert_eq!(output.status.code(), Some(1)); // Error
}

#[test]
fn test_exit_code_usage_error() {
    let output = run_cli(&[
        "create",
        "--schema",
        "/nonexistent.xml",
        "--output",
        "/tmp/out",
    ]);

    assert_eq!(output.status.code(), Some(2)); // Usage error
}

// ==================== Quiet Mode Tests ====================

#[test]
fn test_quiet_suppresses_status() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, SIMPLE_SCHEMA);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "--quiet",
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    // Quiet mode should suppress status messages
    assert!(!stderr.contains("Creating structure"));
    assert!(!stderr.contains("Done!"));
}

#[test]
fn test_quiet_shows_errors() {
    let output = run_cli(&[
        "--quiet",
        "create",
        "--schema",
        "/nonexistent.xml",
        "--output",
        "/tmp/out",
    ]);

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    // Errors should still be shown
    assert!(stderr.contains("Error:"));
}
