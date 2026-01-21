use clap::{Parser, Subcommand};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process;
use structure_creator_lib::{
    database::{get_database_connection, list_templates, increment_use_count},
    schema::parse_xml_schema,
    CreateResult,
};

/// Structure Creator CLI - Generate folder structures from templates or XML schemas
#[derive(Parser)]
#[command(name = "structure-creator")]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new structure from a template or schema
    Create {
        /// Template name or ID to use
        #[arg(short, long, conflicts_with = "schema")]
        template: Option<String>,

        /// Path to XML schema file
        #[arg(short, long, conflicts_with = "template")]
        schema: Option<PathBuf>,

        /// Output directory path (required)
        #[arg(short, long)]
        output: PathBuf,

        /// Variables in KEY=VALUE format (can be specified multiple times)
        #[arg(short = 'V', long = "var")]
        variables: Vec<String>,

        /// Preview changes without creating files
        #[arg(short, long)]
        dry_run: bool,

        /// Overwrite existing files
        #[arg(short = 'f', long)]
        overwrite: bool,
    },

    /// Manage templates
    Template {
        #[command(subcommand)]
        command: TemplateCommands,
    },
}

#[derive(Subcommand)]
enum TemplateCommands {
    /// List all available templates
    List {
        /// Output format
        #[arg(short, long, default_value = "table")]
        format: OutputFormat,
    },

    /// Show details of a specific template
    Show {
        /// Template name or ID
        template: String,

        /// Output format
        #[arg(short, long, default_value = "text")]
        format: ShowFormat,
    },

    /// Export template to an XML file
    Export {
        /// Template name or ID
        template: String,

        /// Output file path
        #[arg(short, long)]
        output: PathBuf,
    },
}

#[derive(Clone, clap::ValueEnum)]
enum OutputFormat {
    Table,
    Json,
}

#[derive(Clone, clap::ValueEnum)]
enum ShowFormat {
    Text,
    Json,
    Xml,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Create {
            template,
            schema,
            output,
            variables,
            dry_run,
            overwrite,
        } => {
            if let Err(e) = handle_create(template, schema, output, variables, dry_run, overwrite) {
                eprintln!("Error: {}", e);
                process::exit(1);
            }
        }
        Commands::Template { command } => {
            if let Err(e) = handle_template_command(command) {
                eprintln!("Error: {}", e);
                process::exit(1);
            }
        }
    }
}

fn handle_create(
    template: Option<String>,
    schema: Option<PathBuf>,
    output: PathBuf,
    variables: Vec<String>,
    dry_run: bool,
    overwrite: bool,
) -> Result<(), String> {
    // Parse variables and wrap keys with % signs
    let mut vars_map = HashMap::new();
    for var in variables {
        let parts: Vec<&str> = var.splitn(2, '=').collect();
        if parts.len() != 2 {
            return Err(format!("Invalid variable format '{}'. Use KEY=VALUE", var));
        }
        // Wrap the variable name with % signs for replacement
        let var_key = format!("%{}%", parts[0]);
        vars_map.insert(var_key, parts[1].to_string());
    }

    // Get schema XML content
    let schema_xml = if let Some(template_id_or_name) = template {
        // Load from template
        let conn = get_database_connection().map_err(|e| format!("Database error: {}", e))?;
        let templates = list_templates(&conn).map_err(|e| format!("Failed to list templates: {}", e))?;

        // Try to find by ID first, then by name
        let template_obj = templates
            .iter()
            .find(|t| t.id == template_id_or_name || t.name == template_id_or_name)
            .ok_or_else(|| format!("Template '{}' not found", template_id_or_name))?;

        // Increment use count
        let _ = increment_use_count(&conn, &template_obj.id);

        println!("Using template: {}", template_obj.name);
        if let Some(desc) = &template_obj.description {
            println!("Description: {}", desc);
        }

        // Merge template variables with CLI variables (CLI takes precedence)
        for (key, value) in template_obj.variables.iter() {
            if !vars_map.contains_key(key) {
                vars_map.insert(key.clone(), value.clone());
            }
        }

        template_obj.schema_xml.clone()
    } else if let Some(schema_path) = schema {
        // Load from file
        std::fs::read_to_string(&schema_path)
            .map_err(|e| format!("Failed to read schema file: {}", e))?
    } else {
        return Err("Either --template or --schema must be specified".to_string());
    };

    // Parse the schema
    let tree = parse_xml_schema(&schema_xml)
        .map_err(|e| format!("Failed to parse schema: {}", e))?;

    println!("\nSchema Statistics:");
    println!("  Folders: {}", tree.stats.folders);
    println!("  Files: {}", tree.stats.files);
    println!("  Downloads: {}", tree.stats.downloads);

    if !vars_map.is_empty() {
        println!("\nVariables:");
        for (key, value) in &vars_map {
            println!("  {} = {}", key, value);
        }
    }

    println!("\nOutput: {}", output.display());
    if dry_run {
        println!("Mode: DRY RUN (no files will be created)");
    }
    println!();

    // Create the structure
    let result = structure_creator_lib::create_structure_from_tree(
        tree,
        output.to_string_lossy().to_string(),
        vars_map,
        dry_run,
        overwrite,
    );

    // Display results
    print_create_result(&result);

    if result.summary.errors > 0 {
        Err("Structure creation completed with errors".to_string())
    } else {
        Ok(())
    }
}

fn handle_template_command(command: TemplateCommands) -> Result<(), String> {
    match command {
        TemplateCommands::List { format } => handle_template_list(format),
        TemplateCommands::Show { template, format } => handle_template_show(template, format),
        TemplateCommands::Export { template, output } => handle_template_export(template, output),
    }
}

fn handle_template_list(format: OutputFormat) -> Result<(), String> {
    let conn = get_database_connection().map_err(|e| format!("Database error: {}", e))?;
    let templates = list_templates(&conn).map_err(|e| format!("Failed to list templates: {}", e))?;

    match format {
        OutputFormat::Table => {
            if templates.is_empty() {
                println!("No templates found.");
                return Ok(());
            }

            // Calculate column widths
            let max_name_len = templates.iter().map(|t| t.name.len()).max().unwrap_or(4).max(4);
            let max_desc_len = templates
                .iter()
                .map(|t| {
                    t.description.as_ref().map(|d: &String| d.len()).unwrap_or(0)
                })
                .max()
                .unwrap_or(11)
                .max(11);

            // Print header
            println!(
                "{:<36} {:<width_name$} {:<width_desc$} {:>5} {:>8}",
                "ID",
                "NAME",
                "DESCRIPTION",
                "USES",
                "FAVORITE",
                width_name = max_name_len,
                width_desc = max_desc_len
            );
            println!("{}", "-".repeat(36 + max_name_len + max_desc_len + 20));

            // Print rows
            for template in &templates {
                println!(
                    "{:<36} {:<width_name$} {:<width_desc$} {:>5} {:>8}",
                    template.id,
                    template.name,
                    template.description.as_deref().unwrap_or(""),
                    template.use_count,
                    if template.is_favorite { "★" } else { "" },
                    width_name = max_name_len,
                    width_desc = max_desc_len
                );
            }

            println!("\nTotal templates: {}", templates.len());
        }
        OutputFormat::Json => {
            let json = serde_json::to_string_pretty(&templates)
                .map_err(|e| format!("Failed to serialize templates: {}", e))?;
            println!("{}", json);
        }
    }

    Ok(())
}

fn handle_template_show(template_id_or_name: String, format: ShowFormat) -> Result<(), String> {
    let conn = get_database_connection().map_err(|e| format!("Database error: {}", e))?;
    let templates = list_templates(&conn).map_err(|e| format!("Failed to list templates: {}", e))?;

    let template = templates
        .iter()
        .find(|t| t.id == template_id_or_name || t.name == template_id_or_name)
        .ok_or_else(|| format!("Template '{}' not found", template_id_or_name))?;

    match format {
        ShowFormat::Text => {
            println!("Template: {}", template.name);
            println!("ID: {}", template.id);
            if let Some(desc) = &template.description {
                println!("Description: {}", desc);
            }
            println!("Use Count: {}", template.use_count);
            println!("Favorite: {}", if template.is_favorite { "Yes" } else { "No" });
            if let Some(color) = &template.icon_color {
                println!("Icon Color: {}", color);
            }
            println!("Created: {}", template.created_at);
            println!("Updated: {}", template.updated_at);

            if !template.variables.is_empty() {
                println!("\nVariables:");
                for (key, value) in &template.variables {
                    println!("  {} = {}", key, value);
                }
            }

            // Parse and show stats
            if let Ok(tree) = parse_xml_schema(&template.schema_xml) {
                println!("\nSchema Statistics:");
                println!("  Folders: {}", tree.stats.folders);
                println!("  Files: {}", tree.stats.files);
                println!("  Downloads: {}", tree.stats.downloads);
            }
        }
        ShowFormat::Json => {
            let json = serde_json::to_string_pretty(&template)
                .map_err(|e| format!("Failed to serialize template: {}", e))?;
            println!("{}", json);
        }
        ShowFormat::Xml => {
            println!("{}", template.schema_xml);
        }
    }

    Ok(())
}

fn handle_template_export(template_id_or_name: String, output: PathBuf) -> Result<(), String> {
    let conn = get_database_connection().map_err(|e| format!("Database error: {}", e))?;
    let templates = list_templates(&conn).map_err(|e| format!("Failed to list templates: {}", e))?;

    let template = templates
        .iter()
        .find(|t| t.id == template_id_or_name || t.name == template_id_or_name)
        .ok_or_else(|| format!("Template '{}' not found", template_id_or_name))?;

    std::fs::write(&output, &template.schema_xml)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    println!("Template '{}' exported to {}", template.name, output.display());

    Ok(())
}

fn print_create_result(result: &CreateResult) {
    // Print logs
    for log in &result.logs {
        let prefix = match log.log_type.as_str() {
            "success" => "✓",
            "error" => "✗",
            "warning" => "⚠",
            "info" => "ℹ",
            _ => "•",
        };

        print!("{} {}", prefix, log.message);
        if let Some(details) = &log.details {
            print!(" ({})", details);
        }
        println!();
    }

    // Print summary
    println!("\n{}", "=".repeat(60));
    println!("Summary:");
    println!("  Folders created: {}", result.summary.folders_created);
    println!("  Files created: {}", result.summary.files_created);
    println!("  Files downloaded: {}", result.summary.files_downloaded);
    if result.summary.skipped > 0 {
        println!("  Skipped: {}", result.summary.skipped);
    }
    if result.summary.errors > 0 {
        println!("  Errors: {}", result.summary.errors);
    }
    println!("{}", "=".repeat(60));
}
