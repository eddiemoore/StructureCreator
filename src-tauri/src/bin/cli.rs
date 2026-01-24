//! CLI interface for Structure Creator
//!
//! Enables automation and CI/CD integration for structure generation.

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use structure_creator_lib::{
    create_structure_from_tree, parse_xml_schema, scan_folder_to_schema, schema_to_xml,
    CreateResult, Database, SchemaTree, Template, ValidationRule,
};

/// Application identifier - must match tauri.conf.json
const APP_IDENTIFIER: &str = "com.structurecreator.app";

/// Current template export format version
const TEMPLATE_EXPORT_VERSION: u32 = 1;

/// Maximum allowed size for template import files (10 MB)
const MAX_TEMPLATE_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Maximum allowed size for schema_xml content (5 MB)
const MAX_SCHEMA_SIZE: usize = 5 * 1024 * 1024;

// Exit codes with clear semantics
mod exit_codes {
    /// Operation completed successfully
    pub const SUCCESS: i32 = 0;
    /// Operation failed
    pub const ERROR: i32 = 1;
    /// Invalid usage or arguments
    pub const USAGE_ERROR: i32 = 2;
}

/// Structure Creator CLI - Generate folder/file structures from XML schemas
#[derive(Parser)]
#[command(name = "structure-creator")]
#[command(author, version, about)]
#[command(after_help = "\
EXAMPLES:
    Create a structure from an XML schema file:
        structure-creator create --schema ./schema.xml --output ./my-project

    Create from a template with variable substitution:
        structure-creator create --template \"React App\" --output ./app --var NAME=MyApp

    Create and overwrite existing files:
        structure-creator create --schema ./schema.xml --output ./my-project --overwrite

    Create from stdin:
        cat schema.xml | structure-creator create --schema - --output ./project

    List all templates:
        structure-creator templates list

    Export a template to share:
        structure-creator templates export \"My Template\" --output ./template.sct

    Export and overwrite existing file:
        structure-creator templates export \"My Template\" --output ./template.sct --overwrite

    Import a template (overwrite if exists):
        structure-creator templates import ./template.sct --force

    Delete a template:
        structure-creator templates delete \"Old Template\" --force

    Scan a folder to create a schema:
        structure-creator scan ./existing-project --output schema.xml

    Scan and overwrite existing output file:
        structure-creator scan ./existing-project --output schema.xml --overwrite

    Validate a schema file:
        structure-creator parse ./schema.xml
")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Suppress non-essential output
    #[arg(short, long, global = true)]
    quiet: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a folder structure from a template or schema
    Create {
        /// Template name to use
        #[arg(short, long, conflicts_with = "schema")]
        template: Option<String>,

        /// Path to XML schema file (use "-" for stdin)
        #[arg(short, long, conflicts_with = "template")]
        schema: Option<String>,

        /// Output directory path
        #[arg(short, long)]
        output: PathBuf,

        /// Variable substitutions (can be used multiple times)
        /// Format: NAME=value
        #[arg(long = "var", value_parser = parse_variable)]
        vars: Vec<(String, String)>,

        /// Preview changes without creating files
        #[arg(long)]
        dry_run: bool,

        /// Overwrite existing files
        #[arg(long)]
        overwrite: bool,

        /// Output results as JSON
        #[arg(long)]
        json: bool,
    },

    /// Manage templates
    Templates {
        #[command(subcommand)]
        action: TemplateAction,
    },

    /// Scan a folder and output its structure as XML schema
    Scan {
        /// Path to folder to scan
        path: PathBuf,

        /// Output file (stdout if not specified)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Overwrite existing output file
        #[arg(long)]
        overwrite: bool,

        /// Output as JSON instead of XML
        #[arg(long)]
        json: bool,
    },

    /// Parse and validate an XML schema
    Parse {
        /// Path to XML schema file (use "-" for stdin)
        schema: String,

        /// Output results as JSON
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum TemplateAction {
    /// List all templates
    List {
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Show details of a template
    Show {
        /// Template name or ID
        name: String,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Export a template to a file
    Export {
        /// Template name or ID
        name: String,

        /// Output file path
        #[arg(short, long)]
        output: PathBuf,

        /// Overwrite existing output file
        #[arg(long)]
        overwrite: bool,
    },

    /// Import a template from a file
    Import {
        /// Path to template file (.sct)
        path: PathBuf,

        /// Overwrite existing template with same name
        #[arg(long)]
        force: bool,
    },

    /// Delete a template
    Delete {
        /// Template name or ID
        name: String,

        /// Skip confirmation
        #[arg(long)]
        force: bool,
    },
}

/// Template export format
#[derive(Debug, Serialize, Deserialize)]
struct TemplateExport {
    version: u32,
    name: String,
    description: Option<String>,
    schema_xml: String,
    variables: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    variable_validation: HashMap<String, ValidationRule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_color: Option<String>,
    #[serde(default)]
    is_favorite: bool,
    #[serde(default)]
    tags: Vec<String>,
}

/// CLI execution result
enum CliResult {
    Success,
    Error(String),
    UsageError(String),
}

fn parse_variable(s: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = s.splitn(2, '=').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid variable format: '{}'. Expected NAME=value",
            s
        ));
    }

    let raw_name = parts[0].trim();

    // Validate variable name
    if raw_name.is_empty() {
        return Err("Variable name cannot be empty".to_string());
    }

    // Check if already wrapped in %% (using strip_prefix/suffix for UTF-8 safety)
    let var_name = if let Some(inner) = raw_name.strip_prefix('%').and_then(|s| s.strip_suffix('%')) {
        // Validate the inner part
        if inner.is_empty() {
            return Err("Variable name cannot be empty".to_string());
        }
        if !is_valid_variable_name(inner) {
            return Err(format!(
                "Invalid variable name '{}'. Use only letters, numbers, and underscores.",
                inner
            ));
        }
        raw_name.to_string()
    } else {
        if !is_valid_variable_name(raw_name) {
            return Err(format!(
                "Invalid variable name '{}'. Use only letters, numbers, and underscores.",
                raw_name
            ));
        }
        format!("%{}%", raw_name)
    };

    Ok((var_name, parts[1].to_string()))
}

fn is_valid_variable_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Truncate a string to a maximum number of characters, adding ellipsis if truncated.
fn truncate_str(s: &str, max_chars: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        s.to_string()
    } else if max_chars <= 3 {
        s.chars().take(max_chars).collect()
    } else {
        let truncated: String = s.chars().take(max_chars - 3).collect();
        format!("{}...", truncated)
    }
}

/// Pad a string to a fixed character width (not byte width).
/// This ensures proper alignment even with multi-byte UTF-8 characters.
fn pad_to_width(s: &str, width: usize) -> String {
    let char_count = s.chars().count();
    if char_count >= width {
        s.to_string()
    } else {
        format!("{}{}", s, " ".repeat(width - char_count))
    }
}

/// Maximum allowed length for template names
const MAX_TEMPLATE_NAME_LENGTH: usize = 256;

/// Column widths for template list display
const LIST_NAME_WIDTH: usize = 30;
const LIST_DESC_WIDTH: usize = 40;

/// Validate CSS hex color format (#RGB or #RRGGBB).
fn validate_icon_color(color: &str) -> Result<(), String> {
    if !color.starts_with('#') {
        return Err("Color must start with '#'".to_string());
    }

    let hex_part = &color[1..];
    let valid_length = hex_part.len() == 3 || hex_part.len() == 6;
    let valid_chars = hex_part.chars().all(|c| c.is_ascii_hexdigit());

    if !valid_length {
        return Err(format!(
            "Color must be #RGB or #RRGGBB format, got {} characters after #",
            hex_part.len()
        ));
    }

    if !valid_chars {
        return Err("Color must contain only hexadecimal characters (0-9, a-f, A-F)".to_string());
    }

    Ok(())
}

/// Validate template name for safety and reasonable constraints.
fn validate_template_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Template name cannot be empty".to_string());
    }

    let char_count = name.chars().count();
    if char_count > MAX_TEMPLATE_NAME_LENGTH {
        return Err(format!(
            "Template name too long ({} characters). Maximum is {} characters.",
            char_count,
            MAX_TEMPLATE_NAME_LENGTH
        ));
    }

    // Disallow path traversal characters
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Template name cannot contain path separators or '..'".to_string());
    }

    // Disallow control characters
    if name.chars().any(|c| c.is_control()) {
        return Err("Template name cannot contain control characters".to_string());
    }

    // Disallow leading/trailing whitespace
    if name != name.trim() {
        return Err("Template name cannot have leading or trailing whitespace".to_string());
    }

    Ok(())
}

fn get_data_dir() -> Result<PathBuf, String> {
    // Match Tauri's app_data_dir() behavior
    // On macOS: ~/Library/Application Support/{identifier}
    // On Linux: ~/.local/share/{identifier}
    // On Windows: C:\Users\{user}\AppData\Roaming\{identifier}
    dirs::data_dir()
        .map(|p| p.join(APP_IDENTIFIER))
        .ok_or_else(|| "Could not determine data directory".to_string())
}

fn get_database() -> Result<Database, String> {
    let data_dir = get_data_dir()?;
    Database::new(data_dir).map_err(|e| format!("Failed to open database: {}", e))
}

/// Extract variable placeholders (%VAR%) from schema content.
/// Returns a set of variable names including the % delimiters.
fn extract_schema_variables(content: &str) -> std::collections::HashSet<String> {
    let mut variables = std::collections::HashSet::new();
    let mut chars = content.chars();

    while let Some(c) = chars.next() {
        if c == '%' {
            let mut var_name = String::from("%");
            for next_c in chars.by_ref() {
                var_name.push(next_c);
                if next_c == '%' {
                    // Found closing %, check if it's a valid variable (not just %%)
                    if var_name.len() > 2 {
                        variables.insert(var_name);
                    }
                    break;
                }
                // Stop if we hit whitespace or special chars (not a valid variable)
                if !next_c.is_ascii_alphanumeric() && next_c != '_' {
                    break;
                }
            }
        }
    }

    variables
}

fn find_template(db: &Database, name_or_id: &str) -> Result<Template, String> {
    // Try to find by ID first
    if let Ok(Some(template)) = db.get_template(name_or_id) {
        return Ok(template);
    }

    // Search by name (case-insensitive)
    match db.get_template_by_name(name_or_id) {
        Ok(Some(template)) => Ok(template),
        Ok(None) => Err(format!("Template not found: '{}'", name_or_id)),
        Err(e) => Err(format!("Database error: {}", e)),
    }
}

/// Indicator for stdin input
const STDIN_INDICATOR: &str = "-";

/// Read schema content from file or stdin.
/// Use "-" to read from stdin.
fn read_schema_content(source: &str) -> Result<String, CliResult> {
    if source == STDIN_INDICATOR {
        // Read from stdin with size limit to prevent memory exhaustion
        let mut content = String::new();
        let limit = (MAX_SCHEMA_SIZE + 1) as u64; // Read one extra byte to detect overflow

        std::io::stdin()
            .take(limit)
            .read_to_string(&mut content)
            .map_err(|e| CliResult::Error(format!("Failed to read from stdin: {}", e)))?;

        if content.len() > MAX_SCHEMA_SIZE {
            return Err(CliResult::Error(format!(
                "Schema from stdin too large (>{} bytes). Maximum allowed size is {} bytes.",
                MAX_SCHEMA_SIZE,
                MAX_SCHEMA_SIZE
            )));
        }

        Ok(content)
    } else {
        let path = std::path::Path::new(source);

        // Validate file exists
        if !path.exists() {
            return Err(CliResult::UsageError(format!(
                "Schema file does not exist: {}",
                path.display()
            )));
        }

        // Check size before reading
        let metadata = std::fs::metadata(path)
            .map_err(|e| CliResult::Error(format!("Failed to access schema file: {}", e)))?;

        if metadata.len() > MAX_SCHEMA_SIZE as u64 {
            return Err(CliResult::Error(format!(
                "Schema file too large ({} bytes). Maximum allowed size is {} bytes.",
                metadata.len(),
                MAX_SCHEMA_SIZE
            )));
        }

        std::fs::read_to_string(path)
            .map_err(|e| CliResult::Error(format!("Failed to read schema file: {}", e)))
    }
}

/// Validate that the output path's parent directory exists and is writable.
/// Note: The readonly check only detects explicitly read-only filesystems/files.
/// It may not detect all permission issues (e.g., Unix permission bits).
fn validate_output_path(path: &std::path::Path) -> Result<(), String> {
    // Get parent directory (or use current dir if output is just a name)
    let parent = path.parent().unwrap_or(std::path::Path::new("."));

    if !parent.as_os_str().is_empty() && !parent.exists() {
        return Err(format!(
            "Parent directory does not exist: {}",
            parent.display()
        ));
    }

    // Check if parent is writable by attempting to get metadata
    // (a more thorough check would try to create a temp file)
    if !parent.as_os_str().is_empty() {
        match std::fs::metadata(parent) {
            Ok(meta) => {
                if meta.permissions().readonly() {
                    return Err(format!(
                        "Parent directory is read-only: {}",
                        parent.display()
                    ));
                }
            }
            Err(e) => {
                return Err(format!(
                    "Cannot access parent directory {}: {}",
                    parent.display(),
                    e
                ));
            }
        }
    }

    Ok(())
}

/// Print to stderr (for status messages)
macro_rules! status {
    ($quiet:expr, $($arg:tt)*) => {
        if !$quiet {
            eprintln!($($arg)*);
        }
    };
}

fn print_result(result: &CreateResult, json_output: bool, quiet: bool) -> CliResult {
    if json_output {
        match serde_json::to_string_pretty(result) {
            Ok(json) => println!("{}", json),
            Err(e) => return CliResult::Error(format!("Failed to serialize result: {}", e)),
        }
    } else if !quiet {
        // Print logs to stderr
        for log in &result.logs {
            let prefix = match log.log_type.as_str() {
                "success" => "+",
                "error" => "!",
                "warning" => "?",
                "info" => "~",
                _ => " ",
            };

            eprintln!("  {} {}", prefix, log.message);
            if let Some(details) = &log.details {
                if log.log_type == "error" {
                    eprintln!("    {}", details);
                }
            }
        }

        // Print summary to stderr
        eprintln!();
        let s = &result.summary;
        if s.errors > 0 || s.hooks_failed > 0 {
            let mut summary_parts = vec![
                format!("{} folders", s.folders_created),
                format!("{} files ({} downloaded)", s.files_created, s.files_downloaded),
            ];
            if s.errors > 0 {
                summary_parts.push(format!("{} errors", s.errors));
            }
            if s.skipped > 0 {
                summary_parts.push(format!("{} skipped", s.skipped));
            }
            if s.hooks_executed > 0 || s.hooks_failed > 0 {
                summary_parts.push(format!("{} hooks ({} failed)", s.hooks_executed + s.hooks_failed, s.hooks_failed));
            }
            eprintln!("Completed with errors: {}", summary_parts.join(", "));
        } else {
            eprintln!(
                "Done! Created {} folders, {} files ({} downloaded)",
                s.folders_created, s.files_created, s.files_downloaded
            );
            if s.skipped > 0 {
                eprintln!("  ({} files skipped - already exist)", s.skipped);
            }
            if s.hooks_executed > 0 {
                eprintln!("  ({} hooks executed successfully)", s.hooks_executed);
            }
        }
    }

    if result.summary.errors > 0 || result.summary.hooks_failed > 0 {
        CliResult::Error("Structure creation completed with errors".to_string())
    } else {
        CliResult::Success
    }
}

fn print_schema_info(tree: &SchemaTree, json_output: bool) -> CliResult {
    if json_output {
        match serde_json::to_string_pretty(tree) {
            Ok(json) => {
                println!("{}", json);
                CliResult::Success
            }
            Err(e) => CliResult::Error(format!("Failed to serialize schema: {}", e)),
        }
    } else {
        // Schema info goes to stdout as it's primary data output
        println!("Schema: {}", tree.root.name);
        println!("  Folders: {}", tree.stats.folders);
        println!("  Files: {}", tree.stats.files);
        println!("  Downloads: {}", tree.stats.downloads);
        CliResult::Success
    }
}

fn cmd_create(
    template: Option<String>,
    schema: Option<String>,
    output: PathBuf,
    vars: Vec<(String, String)>,
    dry_run: bool,
    overwrite: bool,
    json_output: bool,
    quiet: bool,
) -> CliResult {
    // Validate output path early, before expensive operations
    if let Err(e) = validate_output_path(&output) {
        return CliResult::UsageError(e);
    }

    let tree: SchemaTree;
    let schema_content: String;
    let mut variables: HashMap<String, String> = vars.into_iter().collect();

    if let Some(template_name) = template {
        // Use template
        let db = match get_database() {
            Ok(db) => db,
            Err(e) => return CliResult::Error(e),
        };
        let template = match find_template(&db, &template_name) {
            Ok(t) => t,
            Err(e) => return CliResult::Error(e),
        };

        // Increment use count (non-fatal if this fails)
        if let Err(e) = db.increment_use_count(&template.id) {
            status!(quiet || json_output, "Warning: Could not update use count: {}", e);
        }

        // Merge template variables with command-line variables (CLI takes precedence)
        for (k, v) in template.variables {
            variables.entry(k).or_insert(v);
        }

        schema_content = template.schema_xml.clone();
        tree = match parse_xml_schema(&schema_content) {
            Ok(t) => t,
            Err(e) => {
                return CliResult::Error(format!("Failed to parse template schema: {}", e))
            }
        };

        status!(quiet || json_output, "Using template: {}", template.name);
    } else if let Some(schema_source) = schema {
        // Use schema file or stdin
        schema_content = match read_schema_content(&schema_source) {
            Ok(c) => c,
            Err(e) => return e,
        };

        tree = match parse_xml_schema(&schema_content) {
            Ok(t) => t,
            Err(e) => return CliResult::Error(format!("Failed to parse schema: {}", e)),
        };

        // schema_source is String, so borrow it for display
        let source_desc: &str = if schema_source == STDIN_INDICATOR { "stdin" } else { &schema_source };
        status!(quiet || json_output, "Using schema: {}", source_desc);
    } else {
        return CliResult::UsageError(format!(
            "Either --template or --schema must be specified (use \"{}\" for stdin)",
            STDIN_INDICATOR
        ));
    }

    // Warn about variables provided but not used in the schema
    let schema_vars = extract_schema_variables(&schema_content);
    let mut var_names: Vec<_> = variables.keys().collect();
    var_names.sort(); // Sort for reproducible warning order
    for var_name in var_names {
        if !schema_vars.contains(var_name) {
            status!(
                quiet || json_output,
                "Warning: Variable {} is not used in the schema",
                var_name
            );
        }
    }

    let output_str = output.display().to_string();

    if dry_run {
        status!(
            quiet || json_output,
            "Dry run - previewing changes at {}...",
            output_str
        );
    } else {
        status!(
            quiet || json_output,
            "Creating structure at {}...",
            output_str
        );
    }

    match create_structure_from_tree(&tree, &output_str, &variables, dry_run, overwrite) {
        Ok(result) => print_result(&result, json_output, quiet),
        Err(e) => CliResult::Error(e),
    }
}

fn cmd_templates_list(json_output: bool, quiet: bool) -> CliResult {
    let db = match get_database() {
        Ok(db) => db,
        Err(e) => return CliResult::Error(e),
    };
    let templates = match db.list_templates() {
        Ok(t) => t,
        Err(e) => return CliResult::Error(e.to_string()),
    };

    if json_output {
        match serde_json::to_string_pretty(&templates) {
            Ok(json) => {
                println!("{}", json);
                return CliResult::Success;
            }
            Err(e) => return CliResult::Error(format!("Failed to serialize templates: {}", e)),
        }
    }

    if templates.is_empty() {
        status!(quiet, "No templates found.");
        status!(quiet, "Create templates using the Structure Creator app.");
        return CliResult::Success;
    }

    // Template list is primary data output, goes to stdout
    println!("Templates ({}):", templates.len());
    for template in templates {
        let fav = if template.is_favorite { "*" } else { " " };
        let name = truncate_str(&template.name, LIST_NAME_WIDTH);
        let desc = truncate_str(template.description.as_deref().unwrap_or(""), LIST_DESC_WIDTH);
        let usage = match template.use_count {
            0 => "never used".to_string(),
            1 => "used once".to_string(),
            n => format!("used {} times", n),
        };
        // Use character-based padding for proper alignment with non-ASCII names
        println!(
            "  {} {} {} ({})",
            fav,
            pad_to_width(&name, LIST_NAME_WIDTH),
            desc,
            usage
        );
    }

    CliResult::Success
}

fn cmd_templates_show(name: &str, json_output: bool, _quiet: bool) -> CliResult {
    let db = match get_database() {
        Ok(db) => db,
        Err(e) => return CliResult::Error(e),
    };
    let template = match find_template(&db, name) {
        Ok(t) => t,
        Err(e) => return CliResult::Error(e),
    };

    if json_output {
        match serde_json::to_string_pretty(&template) {
            Ok(json) => {
                println!("{}", json);
                return CliResult::Success;
            }
            Err(e) => return CliResult::Error(format!("Failed to serialize template: {}", e)),
        }
    }

    // Template details are primary data output, goes to stdout
    println!("Name: {}", template.name);
    if let Some(desc) = &template.description {
        println!("Description: {}", desc);
    }
    println!("ID: {}", template.id);
    println!(
        "Favorite: {}",
        if template.is_favorite { "Yes" } else { "No" }
    );
    println!("Use count: {}", template.use_count);
    println!("Created: {}", template.created_at);
    println!("Updated: {}", template.updated_at);

    if !template.variables.is_empty() {
        println!("\nVariables:");
        // Sort keys for reproducible output
        let mut vars: Vec<_> = template.variables.iter().collect();
        vars.sort_by_key(|(k, _)| *k);
        for (k, v) in vars {
            println!("  {} = {}", k, v);
        }
    }

    println!("\nSchema:");
    println!("{}", template.schema_xml);

    CliResult::Success
}

fn cmd_templates_export(name: &str, output: &std::path::Path, overwrite: bool, quiet: bool) -> CliResult {
    // Validate output path first
    if let Err(e) = validate_output_path(output) {
        return CliResult::UsageError(e);
    }

    // Check if output file exists and --overwrite not specified
    if output.exists() && !overwrite {
        return CliResult::Error(format!(
            "Output file already exists: {}. Use --overwrite to replace it.",
            output.display()
        ));
    }

    let db = match get_database() {
        Ok(db) => db,
        Err(e) => return CliResult::Error(e),
    };
    let template = match find_template(&db, name) {
        Ok(t) => t,
        Err(e) => return CliResult::Error(e),
    };

    let export = TemplateExport {
        version: TEMPLATE_EXPORT_VERSION,
        name: template.name.clone(),
        description: template.description,
        schema_xml: template.schema_xml,
        variables: template.variables,
        variable_validation: template.variable_validation,
        icon_color: template.icon_color,
        is_favorite: template.is_favorite,
        tags: template.tags,
    };

    let content = match serde_json::to_string_pretty(&export) {
        Ok(c) => c,
        Err(e) => return CliResult::Error(format!("Failed to serialize template: {}", e)),
    };

    if let Err(e) = std::fs::write(output, content) {
        return CliResult::Error(format!("Failed to write file: {}", e));
    }

    status!(quiet, "Exported '{}' to {}", template.name, output.display());

    CliResult::Success
}

fn cmd_templates_import(path: &std::path::Path, force: bool, quiet: bool) -> CliResult {
    // Validate file exists
    if !path.exists() {
        return CliResult::UsageError(format!(
            "Template file does not exist: {}",
            path.display()
        ));
    }

    // Check file size before reading
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => return CliResult::Error(format!("Failed to access file: {}", e)),
    };

    if metadata.len() > MAX_TEMPLATE_FILE_SIZE {
        return CliResult::Error(format!(
            "Template file too large ({} bytes). Maximum allowed size is {} bytes.",
            metadata.len(),
            MAX_TEMPLATE_FILE_SIZE
        ));
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => return CliResult::Error(format!("Failed to read file: {}", e)),
    };

    let export: TemplateExport = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(e) => return CliResult::Error(format!("Failed to parse template file (expected JSON): {}", e)),
    };

    // Check version compatibility
    if export.version == 0 {
        return CliResult::Error("Invalid template file: version cannot be 0".to_string());
    }
    if export.version > TEMPLATE_EXPORT_VERSION {
        return CliResult::Error(format!(
            "Template file version {} is newer than supported version {}. Please update the CLI.",
            export.version, TEMPLATE_EXPORT_VERSION
        ));
    }

    // Validate template name
    if let Err(e) = validate_template_name(&export.name) {
        return CliResult::Error(format!("Invalid template name: {}", e));
    }

    // Validate schema size
    if export.schema_xml.len() > MAX_SCHEMA_SIZE {
        return CliResult::Error(format!(
            "Schema XML too large ({} bytes). Maximum allowed size is {} bytes.",
            export.schema_xml.len(),
            MAX_SCHEMA_SIZE
        ));
    }

    // Validate the schema content
    if let Err(e) = parse_xml_schema(&export.schema_xml) {
        return CliResult::Error(format!("Invalid schema in template: {}", e));
    }

    // Validate icon_color format if present
    if let Some(ref color) = export.icon_color {
        if let Err(e) = validate_icon_color(color) {
            return CliResult::Error(format!("Invalid icon_color '{}': {}", color, e));
        }
    }

    let db = match get_database() {
        Ok(db) => db,
        Err(e) => return CliResult::Error(e),
    };

    // Check for existing template with same name (case-insensitive)
    match db.get_template_by_name(&export.name) {
        Ok(Some(existing)) => {
            if force {
                // Delete existing template
                if let Err(e) = db.delete_template(&existing.id) {
                    return CliResult::Error(format!("Failed to delete existing template: {}", e));
                }
                status!(quiet, "Replacing existing template '{}'", export.name);
            } else {
                return CliResult::Error(format!(
                    "Template '{}' already exists. Use --force to overwrite.",
                    export.name
                ));
            }
        }
        Ok(None) => {}
        Err(e) => return CliResult::Error(format!("Database error: {}", e)),
    }

    let input = structure_creator_lib::CreateTemplateInput {
        name: export.name,
        description: export.description,
        schema_xml: export.schema_xml,
        variables: export.variables,
        variable_validation: export.variable_validation,
        icon_color: export.icon_color,
        is_favorite: export.is_favorite,
        tags: export.tags,
    };

    let template = match db.create_template(input) {
        Ok(t) => t,
        Err(e) => return CliResult::Error(format!("Failed to create template: {}", e)),
    };

    status!(
        quiet,
        "Imported template '{}' (ID: {})",
        template.name,
        template.id
    );

    CliResult::Success
}

fn cmd_templates_delete(name: &str, force: bool, quiet: bool) -> CliResult {
    let db = match get_database() {
        Ok(db) => db,
        Err(e) => return CliResult::Error(e),
    };

    let template = match find_template(&db, name) {
        Ok(t) => t,
        Err(e) => return CliResult::Error(e),
    };

    // Require --force flag to prevent accidental deletion
    if !force {
        return CliResult::Error(format!(
            "Refusing to delete template '{}' without confirmation. Use --force to confirm deletion.",
            template.name
        ));
    }

    match db.delete_template(&template.id) {
        Ok(true) => {
            status!(quiet, "Deleted template '{}'", template.name);
            CliResult::Success
        }
        Ok(false) => CliResult::Error(
            "Template not found. It may have been deleted by another process. Try listing templates to verify.".to_string()
        ),
        Err(e) => CliResult::Error(format!("Failed to delete template: {}", e)),
    }
}

fn cmd_scan(path: &std::path::Path, output: Option<&std::path::Path>, overwrite: bool, json_output: bool, quiet: bool) -> CliResult {
    if !path.exists() {
        return CliResult::UsageError(format!("Path does not exist: {}", path.display()));
    }

    if !path.is_dir() {
        return CliResult::UsageError(format!("Path is not a directory: {}", path.display()));
    }

    // Validate output path if specified
    if let Some(out) = output {
        if let Err(e) = validate_output_path(out) {
            return CliResult::UsageError(e);
        }

        // Check if output file exists and --overwrite not specified
        if out.exists() && !overwrite {
            return CliResult::Error(format!(
                "Output file already exists: {}. Use --overwrite to replace it.",
                out.display()
            ));
        }
    }

    let tree = match scan_folder_to_schema(&path.to_string_lossy()) {
        Ok(t) => t,
        Err(e) => return CliResult::Error(format!("Failed to scan folder: {}", e)),
    };

    let content = if json_output {
        match serde_json::to_string_pretty(&tree) {
            Ok(json) => json,
            Err(e) => return CliResult::Error(format!("Failed to serialize schema: {}", e)),
        }
    } else {
        schema_to_xml(&tree)
    };

    if let Some(output_path) = output {
        if let Err(e) = std::fs::write(output_path, &content) {
            return CliResult::Error(format!("Failed to write file: {}", e));
        }
        status!(quiet, "Schema written to {}", output_path.display());
        status!(quiet, "  Folders: {}", tree.stats.folders);
        status!(quiet, "  Files: {}", tree.stats.files);
    } else {
        // Write to stdout (primary data output)
        // Ensure output ends with newline for proper terminal display
        if content.ends_with('\n') {
            print!("{}", content);
        } else {
            println!("{}", content);
        }
        if let Err(e) = std::io::stdout().flush() {
            return CliResult::Error(format!("Failed to write to stdout: {}", e));
        }
    }

    CliResult::Success
}

fn cmd_parse(schema_source: &str, json_output: bool, quiet: bool) -> CliResult {
    let content = match read_schema_content(schema_source) {
        Ok(c) => c,
        Err(e) => return e,
    };

    let tree = match parse_xml_schema(&content) {
        Ok(t) => t,
        Err(e) => return CliResult::Error(format!("Failed to parse schema: {}", e)),
    };

    // schema_source is already &str
    let source_desc: &str = if schema_source == STDIN_INDICATOR { "stdin" } else { schema_source };
    status!(quiet || json_output, "Schema from {} is valid.", source_desc);

    print_schema_info(&tree, json_output)
}

fn main() {
    let cli = Cli::parse();
    let quiet = cli.quiet;

    let result = match cli.command {
        Commands::Create {
            template,
            schema,
            output,
            vars,
            dry_run,
            overwrite,
            json,
        } => cmd_create(template, schema, output, vars, dry_run, overwrite, json, quiet),

        Commands::Templates { action } => match action {
            TemplateAction::List { json } => cmd_templates_list(json, quiet),
            TemplateAction::Show { name, json } => cmd_templates_show(&name, json, quiet),
            TemplateAction::Export { name, output, overwrite } => cmd_templates_export(&name, &output, overwrite, quiet),
            TemplateAction::Import { path, force } => cmd_templates_import(&path, force, quiet),
            TemplateAction::Delete { name, force } => cmd_templates_delete(&name, force, quiet),
        },

        Commands::Scan { path, output, overwrite, json } => cmd_scan(&path, output.as_deref(), overwrite, json, quiet),

        Commands::Parse { schema, json } => cmd_parse(&schema, json, quiet),
    };

    match result {
        CliResult::Success => std::process::exit(exit_codes::SUCCESS),
        CliResult::Error(e) => {
            // Errors always print, regardless of --quiet
            eprintln!("Error: {}", e);
            std::process::exit(exit_codes::ERROR);
        }
        CliResult::UsageError(e) => {
            // Usage errors always print, regardless of --quiet
            eprintln!("Error: {}", e);
            std::process::exit(exit_codes::USAGE_ERROR);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== parse_variable tests ====================

    #[test]
    fn test_parse_variable_simple() {
        let result = parse_variable("NAME=value").unwrap();
        assert_eq!(result, ("%NAME%".to_string(), "value".to_string()));
    }

    #[test]
    fn test_parse_variable_wrapped() {
        let result = parse_variable("%NAME%=value").unwrap();
        assert_eq!(result, ("%NAME%".to_string(), "value".to_string()));
    }

    #[test]
    fn test_parse_variable_empty_name() {
        let result = parse_variable("=value");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_parse_variable_no_equals() {
        let result = parse_variable("NAME");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Expected NAME=value"));
    }

    #[test]
    fn test_parse_variable_empty_value() {
        let result = parse_variable("NAME=").unwrap();
        assert_eq!(result, ("%NAME%".to_string(), "".to_string()));
    }

    #[test]
    fn test_parse_variable_value_with_equals() {
        let result = parse_variable("NAME=a=b=c").unwrap();
        assert_eq!(result, ("%NAME%".to_string(), "a=b=c".to_string()));
    }

    #[test]
    fn test_parse_variable_invalid_chars() {
        let result = parse_variable("NA-ME=value");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("letters, numbers, and underscores"));
    }

    #[test]
    fn test_parse_variable_with_underscore() {
        let result = parse_variable("MY_VAR=value").unwrap();
        assert_eq!(result, ("%MY_VAR%".to_string(), "value".to_string()));
    }

    #[test]
    fn test_parse_variable_wrapped_empty_inner() {
        let result = parse_variable("%%=value");
        assert!(result.is_err());
    }

    // ==================== is_valid_variable_name tests ====================

    #[test]
    fn test_valid_variable_name_alphanumeric() {
        assert!(is_valid_variable_name("NAME123"));
    }

    #[test]
    fn test_valid_variable_name_underscore() {
        assert!(is_valid_variable_name("MY_VAR"));
    }

    #[test]
    fn test_valid_variable_name_empty() {
        assert!(!is_valid_variable_name(""));
    }

    #[test]
    fn test_valid_variable_name_special_chars() {
        assert!(!is_valid_variable_name("MY-VAR"));
        assert!(!is_valid_variable_name("MY.VAR"));
        assert!(!is_valid_variable_name("MY VAR"));
    }

    #[test]
    fn test_valid_variable_name_numbers_only() {
        assert!(is_valid_variable_name("123"));
    }

    // ==================== truncate_str tests ====================

    #[test]
    fn test_truncate_str_short() {
        assert_eq!(truncate_str("abc", 10), "abc");
    }

    #[test]
    fn test_truncate_str_exact() {
        assert_eq!(truncate_str("abcde", 5), "abcde");
    }

    #[test]
    fn test_truncate_str_long() {
        assert_eq!(truncate_str("abcdefgh", 5), "ab...");
    }

    #[test]
    fn test_truncate_str_unicode() {
        assert_eq!(truncate_str("日本語テスト", 4), "日...");
    }

    #[test]
    fn test_truncate_str_tiny_max() {
        assert_eq!(truncate_str("abc", 2), "ab");
    }

    #[test]
    fn test_truncate_str_empty() {
        assert_eq!(truncate_str("", 5), "");
    }

    #[test]
    fn test_truncate_str_max_three() {
        assert_eq!(truncate_str("abcdef", 3), "abc");
    }

    // ==================== pad_to_width tests ====================

    #[test]
    fn test_pad_to_width_short() {
        assert_eq!(pad_to_width("abc", 6), "abc   ");
    }

    #[test]
    fn test_pad_to_width_exact() {
        assert_eq!(pad_to_width("abcdef", 6), "abcdef");
    }

    #[test]
    fn test_pad_to_width_long() {
        assert_eq!(pad_to_width("abcdefgh", 6), "abcdefgh");
    }

    #[test]
    fn test_pad_to_width_unicode() {
        assert_eq!(pad_to_width("日本", 4), "日本  ");
    }

    #[test]
    fn test_pad_to_width_empty() {
        assert_eq!(pad_to_width("", 3), "   ");
    }

    // ==================== validate_icon_color tests ====================

    #[test]
    fn test_validate_color_rgb() {
        assert!(validate_icon_color("#fff").is_ok());
        assert!(validate_icon_color("#FFF").is_ok());
        assert!(validate_icon_color("#a1b").is_ok());
    }

    #[test]
    fn test_validate_color_rrggbb() {
        assert!(validate_icon_color("#ff0000").is_ok());
        assert!(validate_icon_color("#FF0000").is_ok());
        assert!(validate_icon_color("#a1b2c3").is_ok());
    }

    #[test]
    fn test_validate_color_no_hash() {
        let result = validate_icon_color("ff0000");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("start with '#'"));
    }

    #[test]
    fn test_validate_color_invalid_length() {
        assert!(validate_icon_color("#ffff").is_err());
        assert!(validate_icon_color("#ff").is_err());
        assert!(validate_icon_color("#fffffff").is_err());
    }

    #[test]
    fn test_validate_color_invalid_chars() {
        let result = validate_icon_color("#gggggg");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("hexadecimal"));
    }

    // ==================== validate_template_name tests ====================

    #[test]
    fn test_validate_name_valid() {
        assert!(validate_template_name("My Template").is_ok());
        assert!(validate_template_name("React App v2").is_ok());
        assert!(validate_template_name("test").is_ok());
    }

    #[test]
    fn test_validate_name_empty() {
        let result = validate_template_name("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn test_validate_name_too_long() {
        let long_name = "a".repeat(257);
        let result = validate_template_name(&long_name);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too long"));
    }

    #[test]
    fn test_validate_name_path_separator_forward() {
        let result = validate_template_name("foo/bar");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path separators"));
    }

    #[test]
    fn test_validate_name_path_separator_back() {
        let result = validate_template_name("foo\\bar");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path separators"));
    }

    #[test]
    fn test_validate_name_dot_dot() {
        let result = validate_template_name("foo..bar");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("'..'"));
    }

    #[test]
    fn test_validate_name_control_char() {
        let result = validate_template_name("foo\x00bar");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("control characters"));
    }

    #[test]
    fn test_validate_name_leading_space() {
        let result = validate_template_name(" foo");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("whitespace"));
    }

    #[test]
    fn test_validate_name_trailing_space() {
        let result = validate_template_name("foo ");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("whitespace"));
    }

    // ==================== extract_schema_variables tests ====================

    #[test]
    fn test_extract_vars_single() {
        let vars = extract_schema_variables("Hello %NAME%!");
        assert_eq!(vars.len(), 1);
        assert!(vars.contains("%NAME%"));
    }

    #[test]
    fn test_extract_vars_multiple() {
        let vars = extract_schema_variables("%A% and %B% and %C%");
        assert_eq!(vars.len(), 3);
        assert!(vars.contains("%A%"));
        assert!(vars.contains("%B%"));
        assert!(vars.contains("%C%"));
    }

    #[test]
    fn test_extract_vars_duplicate() {
        let vars = extract_schema_variables("%A% %A% %A%");
        assert_eq!(vars.len(), 1);
        assert!(vars.contains("%A%"));
    }

    #[test]
    fn test_extract_vars_empty_percent() {
        let vars = extract_schema_variables("100%% complete");
        assert_eq!(vars.len(), 0);
    }

    #[test]
    fn test_extract_vars_unclosed() {
        let vars = extract_schema_variables("Hello %NAME");
        assert_eq!(vars.len(), 0);
    }

    #[test]
    fn test_extract_vars_with_underscore() {
        let vars = extract_schema_variables("%MY_VAR%");
        assert_eq!(vars.len(), 1);
        assert!(vars.contains("%MY_VAR%"));
    }

    #[test]
    fn test_extract_vars_with_numbers() {
        let vars = extract_schema_variables("%VAR1% %VAR2%");
        assert_eq!(vars.len(), 2);
        assert!(vars.contains("%VAR1%"));
        assert!(vars.contains("%VAR2%"));
    }

    #[test]
    fn test_extract_vars_none() {
        let vars = extract_schema_variables("No variables here");
        assert_eq!(vars.len(), 0);
    }

    #[test]
    fn test_extract_vars_invalid_chars_breaks() {
        // %VAR-NAME% should not match because of the hyphen
        let vars = extract_schema_variables("%VAR-NAME%");
        assert_eq!(vars.len(), 0);
    }
}
