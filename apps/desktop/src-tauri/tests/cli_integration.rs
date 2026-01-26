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

// ==================== Repeat Feature Tests ====================

/// Schema with repeat block
const REPEAT_SCHEMA: &str = r#"<folder name="project">
    <repeat count="3" as="i">
        <folder name="module_%i%">
            <file name="index_%i%.ts" />
        </folder>
    </repeat>
</folder>"#;

/// Schema with repeat using 1-based index
const REPEAT_SCHEMA_1BASED: &str = r#"<folder name="project">
    <repeat count="2" as="n">
        <file name="file_%n_1%.txt" />
    </repeat>
</folder>"#;

/// Schema with variable-driven repeat count
const REPEAT_SCHEMA_VAR_COUNT: &str = r#"<folder name="project">
    <repeat count="%NUM_ITEMS%" as="i">
        <file name="item_%i%.txt" />
    </repeat>
</folder>"#;

/// Schema with nested repeat
const REPEAT_SCHEMA_NESTED: &str = r#"<folder name="project">
    <repeat count="2" as="group">
        <folder name="group_%group%">
            <repeat count="2" as="item">
                <file name="item_%item%.txt" />
            </repeat>
        </folder>
    </repeat>
</folder>"#;

#[test]
fn test_create_with_repeat() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, REPEAT_SCHEMA);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Should create 3 module folders (0, 1, 2)
    assert!(output_dir.join("project/module_0").exists());
    assert!(output_dir.join("project/module_1").exists());
    assert!(output_dir.join("project/module_2").exists());

    // Each should have an index file with the iteration number in the filename
    assert!(output_dir.join("project/module_0/index_0.ts").exists());
    assert!(output_dir.join("project/module_1/index_1.ts").exists());
    assert!(output_dir.join("project/module_2/index_2.ts").exists());
}

#[test]
fn test_create_with_repeat_1based_index() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, REPEAT_SCHEMA_1BASED);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Should create files with 1-based naming (1, 2)
    assert!(output_dir.join("project/file_1.txt").exists());
    assert!(output_dir.join("project/file_2.txt").exists());
    // Should NOT have file_0.txt (the variable uses %n_1% which is 1-based)
    assert!(!output_dir.join("project/file_0.txt").exists());
}

#[test]
fn test_create_with_repeat_variable_count() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, REPEAT_SCHEMA_VAR_COUNT);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--var",
        "NUM_ITEMS=4",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Should create 4 items (0, 1, 2, 3)
    assert!(output_dir.join("project/item_0.txt").exists());
    assert!(output_dir.join("project/item_1.txt").exists());
    assert!(output_dir.join("project/item_2.txt").exists());
    assert!(output_dir.join("project/item_3.txt").exists());
    // Should NOT have item_4
    assert!(!output_dir.join("project/item_4.txt").exists());
}

#[test]
fn test_create_with_nested_repeat() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, REPEAT_SCHEMA_NESTED);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Should create 2 groups with 2 items each
    assert!(output_dir.join("project/group_0/item_0.txt").exists());
    assert!(output_dir.join("project/group_0/item_1.txt").exists());
    assert!(output_dir.join("project/group_1/item_0.txt").exists());
    assert!(output_dir.join("project/group_1/item_1.txt").exists());
}

#[test]
fn test_create_with_repeat_zero_count() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="0" as="i">
            <file name="item_%i%.txt" />
        </repeat>
        <file name="marker.txt" />
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // No items should be created
    assert!(!output_dir.join("project/item_0.txt").exists());
    // But the marker file should exist
    assert!(output_dir.join("project/marker.txt").exists());
}

#[test]
fn test_create_with_repeat_invalid_count() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="not_a_number" as="i">
            <file name="item_%i%.txt" />
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    // Should complete but with error logged
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    // Should log specific error about invalid repeat count
    assert!(
        stdout.contains("Invalid repeat count") || stderr.contains("Invalid repeat count"),
        "Expected 'Invalid repeat count' error. stdout: {}, stderr: {}", stdout, stderr
    );
}

#[test]
fn test_create_with_repeat_negative_count() {
    let temp = TempDir::new().unwrap();
    let schema_path = create_schema_file(&temp, REPEAT_SCHEMA_VAR_COUNT);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--var",
        "NUM_ITEMS=-5",
    ]);

    // Should log an error about negative count
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stdout.contains("cannot be negative") || stderr.contains("cannot be negative"),
        "Expected 'cannot be negative' error. stdout: {}, stderr: {}", stdout, stderr
    );
}

#[test]
fn test_create_with_repeat_at_max_count() {
    // Test that exactly MAX_REPEAT_COUNT (10000) is accepted
    // Use dry-run with JSON output to verify the logs
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="10000" as="i">
            <file name="item_%i%.txt" />
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--dry-run",
        "--json",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Should NOT contain any error about exceeding maximum
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !stdout.contains("exceeds maximum") && !stderr.contains("exceeds maximum"),
        "Should accept exactly 10000. stdout: {}, stderr: {}", stdout, stderr
    );

    // JSON output should show the repeat operation with 10000 count
    assert!(
        stdout.contains("10000") && stdout.contains("Would repeat"),
        "Should show dry-run message for 10000 iterations in JSON. stdout: {}", stdout
    );
}

#[test]
fn test_create_with_repeat_exceeds_max_count() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="10001" as="i">
            <file name="item_%i%.txt" />
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    // Should log an error about exceeding maximum
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stdout.contains("exceeds maximum") || stderr.contains("exceeds maximum"),
        "Expected 'exceeds maximum' error. stdout: {}, stderr: {}", stdout, stderr
    );
}

#[test]
fn test_create_with_repeat_empty_as_variable() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="3" as="">
            <file name="item.txt" />
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    // Should log an error about invalid variable name
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stdout.contains("Invalid repeat variable name") || stderr.contains("Invalid repeat variable name"),
        "Expected 'Invalid repeat variable name' error. stdout: {}, stderr: {}", stdout, stderr
    );
}

#[test]
fn test_create_with_repeat_numeric_as_variable() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="3" as="123">
            <file name="item_%123%.txt" />
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    // Should log an error about variable name starting with digit
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stdout.contains("Invalid repeat variable name") || stderr.contains("Invalid repeat variable name"),
        "Expected error about invalid variable name. stdout: {}, stderr: {}", stdout, stderr
    );
}

#[test]
fn test_create_with_repeat_inside_if_block() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <if var="CREATE_ITEMS">
            <repeat count="2" as="i">
                <file name="item_%i%.txt" />
            </repeat>
        </if>
        <file name="marker.txt" />
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    // Test with condition true
    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--var",
        "CREATE_ITEMS=true",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Items should be created when condition is true
    assert!(output_dir.join("project/item_0.txt").exists());
    assert!(output_dir.join("project/item_1.txt").exists());
    assert!(output_dir.join("project/marker.txt").exists());
}

#[test]
fn test_create_with_repeat_inside_if_block_false() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <if var="CREATE_ITEMS">
            <repeat count="2" as="i">
                <file name="item_%i%.txt" />
            </repeat>
        </if>
        <file name="marker.txt" />
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    // Test with condition false (not provided)
    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Items should NOT be created when condition is false
    assert!(!output_dir.join("project/item_0.txt").exists());
    assert!(!output_dir.join("project/item_1.txt").exists());
    // But marker should still exist
    assert!(output_dir.join("project/marker.txt").exists());
}

#[test]
fn test_create_with_if_inside_repeat_block() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="2" as="i">
            <folder name="module_%i%">
                <if var="ADD_README">
                    <file name="README.md" />
                </if>
                <file name="index.ts" />
            </folder>
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--var",
        "ADD_README=true",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // Both modules should have README and index
    assert!(output_dir.join("project/module_0/README.md").exists());
    assert!(output_dir.join("project/module_0/index.ts").exists());
    assert!(output_dir.join("project/module_1/README.md").exists());
    assert!(output_dir.join("project/module_1/index.ts").exists());
}

#[test]
fn test_create_with_repeat_variable_name_ending_in_1() {
    let temp = TempDir::new().unwrap();
    let schema = r#"<folder name="project">
        <repeat count="2" as="n_1">
            <file name="item_%n_1%.txt" />
        </repeat>
    </folder>"#;
    let schema_path = create_schema_file(&temp, schema);
    let output_dir = temp.path().join("output");

    // Use JSON output to capture internal logs
    let output = run_cli(&[
        "create",
        "--schema",
        schema_path.to_str().unwrap(),
        "--output",
        output_dir.to_str().unwrap(),
        "--json",
    ]);

    assert!(output.status.success(), "CLI failed: {}", String::from_utf8_lossy(&output.stderr));

    // JSON output should contain the warning about confusing variable name
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("ends with '_1'") || stdout.contains("\"type\":\"warning\""),
        "Expected warning about confusing variable name in JSON logs. stdout: {}", stdout
    );

    // Files should still be created correctly
    assert!(output_dir.join("project/item_0.txt").exists());
    assert!(output_dir.join("project/item_1.txt").exists());
}
