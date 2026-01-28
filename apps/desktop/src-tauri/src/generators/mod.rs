//! Binary file generators for placeholder images and SQLite databases.
//!
//! This module provides generators that create binary files from XML schema definitions:
//! - Image generator: Creates solid color PNG/JPEG placeholder images
//! - SQLite generator: Creates SQLite databases from raw SQL statements

mod image;
mod sqlite;

pub use image::generate_image;
pub use sqlite::generate_sqlite;

use crate::schema::SchemaNode;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

// Pre-compiled regexes for image attribute parsing
static RE_WIDTH: OnceLock<Regex> = OnceLock::new();
static RE_HEIGHT: OnceLock<Regex> = OnceLock::new();
static RE_BACKGROUND: OnceLock<Regex> = OnceLock::new();
static RE_FORMAT: OnceLock<Regex> = OnceLock::new();

fn get_image_regexes() -> (&'static Regex, &'static Regex, &'static Regex, &'static Regex) {
    let re_width = RE_WIDTH.get_or_init(|| {
        Regex::new(r#"width\s*=\s*["']?([^"'\s]+)["']?"#).unwrap()
    });
    let re_height = RE_HEIGHT.get_or_init(|| {
        Regex::new(r#"height\s*=\s*["']?([^"'\s]+)["']?"#).unwrap()
    });
    let re_background = RE_BACKGROUND.get_or_init(|| {
        Regex::new(r#"background\s*=\s*["']?([^"'\s]+)["']?"#).unwrap()
    });
    let re_format = RE_FORMAT.get_or_init(|| {
        Regex::new(r#"format\s*=\s*["']?([^"'\s]+)["']?"#).unwrap()
    });
    (re_width, re_height, re_background, re_format)
}

/// Configuration parsed from image generator attributes
#[derive(Debug, Clone)]
pub struct ImageConfig {
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub format: ImageFormat,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl Default for ImageConfig {
    fn default() -> Self {
        Self {
            width: 100,
            height: 100,
            background: "#CCCCCC".to_string(),
            format: ImageFormat::Png,
        }
    }
}

/// Parse image configuration from node content and file extension
pub fn parse_image_config(node: &SchemaNode, variables: &HashMap<String, String>) -> ImageConfig {
    let mut config = ImageConfig::default();

    // Determine format from file extension
    let name = &node.name;
    if name.ends_with(".jpg") || name.ends_with(".jpeg") {
        config.format = ImageFormat::Jpeg;
    }

    // Parse configuration from generate_config if present
    // Expected format: width="800" height="600" background="#3B82F6"
    if let Some(config_str) = &node.generate_config {
        config = parse_image_attributes(config_str, variables, config);
    }

    // Also check content field which may have attributes embedded
    if let Some(content) = &node.content {
        config = parse_image_attributes(content, variables, config);
    }

    config
}

/// Parse image attributes from a string containing width/height/background/format
fn parse_image_attributes(input: &str, variables: &HashMap<String, String>, mut config: ImageConfig) -> ImageConfig {
    let (re_width, re_height, re_background, re_format) = get_image_regexes();

    if let Some(caps) = re_width.captures(input) {
        let value = crate::transforms::substitute_variables(&caps[1], variables);
        if let Ok(w) = value.trim().parse::<u32>() {
            config.width = w.clamp(1, 10000);
        }
    }

    if let Some(caps) = re_height.captures(input) {
        let value = crate::transforms::substitute_variables(&caps[1], variables);
        if let Ok(h) = value.trim().parse::<u32>() {
            config.height = h.clamp(1, 10000);
        }
    }

    if let Some(caps) = re_background.captures(input) {
        let value = crate::transforms::substitute_variables(&caps[1], variables);
        config.background = value.trim().to_string();
    }

    if let Some(caps) = re_format.captures(input) {
        let value = caps[1].to_lowercase();
        match value.as_str() {
            "jpeg" | "jpg" => config.format = ImageFormat::Jpeg,
            "png" => config.format = ImageFormat::Png,
            _ => {}
        }
    }

    config
}

/// Parse a hex color string to RGB values
pub fn parse_hex_color(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.trim_start_matches('#');

    match hex.len() {
        // Short form: #RGB -> #RRGGBB
        3 => {
            let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()?;
            let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()?;
            let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()?;
            Some((r, g, b))
        }
        // Full form: #RRGGBB
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some((r, g, b))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hex_color_full() {
        assert_eq!(parse_hex_color("#FF0000"), Some((255, 0, 0)));
        assert_eq!(parse_hex_color("#00FF00"), Some((0, 255, 0)));
        assert_eq!(parse_hex_color("#0000FF"), Some((0, 0, 255)));
        assert_eq!(parse_hex_color("#3B82F6"), Some((59, 130, 246)));
        assert_eq!(parse_hex_color("CCCCCC"), Some((204, 204, 204)));
    }

    #[test]
    fn test_parse_hex_color_short() {
        assert_eq!(parse_hex_color("#F00"), Some((255, 0, 0)));
        assert_eq!(parse_hex_color("#0F0"), Some((0, 255, 0)));
        assert_eq!(parse_hex_color("#00F"), Some((0, 0, 255)));
        assert_eq!(parse_hex_color("CCC"), Some((204, 204, 204)));
    }

    #[test]
    fn test_parse_hex_color_invalid() {
        assert_eq!(parse_hex_color("#GGG"), None);
        assert_eq!(parse_hex_color("#12"), None);
        assert_eq!(parse_hex_color("#1234567"), None);
    }

    #[test]
    fn test_parse_image_attributes() {
        let vars = HashMap::new();
        let config = ImageConfig::default();

        let result = parse_image_attributes(r##"width="800" height="600" background="#FF0000""##, &vars, config);
        assert_eq!(result.width, 800);
        assert_eq!(result.height, 600);
        assert_eq!(result.background, "#FF0000");
    }

    #[test]
    fn test_parse_image_attributes_with_variables() {
        let mut vars = HashMap::new();
        vars.insert("%SIZE%".to_string(), "256".to_string());
        vars.insert("%COLOR%".to_string(), "#00FF00".to_string());

        let config = ImageConfig::default();
        let result = parse_image_attributes(r#"width="%SIZE%" height="%SIZE%" background="%COLOR%""#, &vars, config);
        assert_eq!(result.width, 256);
        assert_eq!(result.height, 256);
        assert_eq!(result.background, "#00FF00");
    }

    #[test]
    fn test_parse_image_config_format_from_extension() {
        let vars = HashMap::new();

        let mut node = SchemaNode {
            node_type: "file".to_string(),
            name: "image.png".to_string(),
            generate: Some("image".to_string()),
            ..Default::default()
        };

        let config = parse_image_config(&node, &vars);
        assert_eq!(config.format, ImageFormat::Png);

        node.name = "image.jpg".to_string();
        let config = parse_image_config(&node, &vars);
        assert_eq!(config.format, ImageFormat::Jpeg);

        node.name = "image.jpeg".to_string();
        let config = parse_image_config(&node, &vars);
        assert_eq!(config.format, ImageFormat::Jpeg);
    }
}
