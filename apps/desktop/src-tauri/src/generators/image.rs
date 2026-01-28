//! Image generator for creating placeholder images.
//!
//! Generates solid color PNG or JPEG images with configurable dimensions.

use super::{parse_hex_color, parse_image_config, ImageFormat};
use crate::schema::SchemaNode;
use image::{ImageBuffer, Rgb, RgbImage};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

/// Generate a placeholder image file.
///
/// # Arguments
/// * `node` - The schema node with generate="image" attribute
/// * `path` - The destination file path
/// * `variables` - Variable substitution map
/// * `dry_run` - If true, returns Ok without writing the file
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(String)` on failure with error message
pub fn generate_image(
    node: &SchemaNode,
    path: &Path,
    variables: &HashMap<String, String>,
    dry_run: bool,
) -> Result<(), String> {
    let config = parse_image_config(node, variables);

    if dry_run {
        return Ok(());
    }

    // Parse background color
    let (r, g, b) = parse_hex_color(&config.background)
        .unwrap_or((204, 204, 204)); // Default gray

    // Create image buffer
    let img: RgbImage = ImageBuffer::from_fn(config.width, config.height, |_, _| {
        Rgb([r, g, b])
    });

    // Encode to the appropriate format
    let mut buffer = Cursor::new(Vec::new());
    match config.format {
        ImageFormat::Png => {
            img.write_to(&mut buffer, image::ImageFormat::Png)
                .map_err(|e| format!("Failed to encode PNG: {}", e))?;
        }
        ImageFormat::Jpeg => {
            img.write_to(&mut buffer, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
        }
    }

    // Write to file
    std::fs::write(path, buffer.into_inner())
        .map_err(|e| format!("Failed to write image file: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_generate_png_image() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.png");

        let node = SchemaNode {
            node_type: "file".to_string(),
            name: "test.png".to_string(),
            generate: Some("image".to_string()),
            generate_config: Some(r##"width="100" height="50" background="#FF0000""##.to_string()),
            ..Default::default()
        };

        let vars = HashMap::new();
        generate_image(&node, &path, &vars, false).unwrap();

        assert!(path.exists());

        // Verify it's a valid PNG
        let data = std::fs::read(&path).unwrap();
        assert!(data.starts_with(&[0x89, 0x50, 0x4E, 0x47])); // PNG magic bytes
    }

    #[test]
    fn test_generate_jpeg_image() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.jpg");

        let node = SchemaNode {
            node_type: "file".to_string(),
            name: "test.jpg".to_string(),
            generate: Some("image".to_string()),
            generate_config: Some(r##"width="200" height="100" background="#00FF00""##.to_string()),
            ..Default::default()
        };

        let vars = HashMap::new();
        generate_image(&node, &path, &vars, false).unwrap();

        assert!(path.exists());

        // Verify it's a valid JPEG
        let data = std::fs::read(&path).unwrap();
        assert!(data.starts_with(&[0xFF, 0xD8, 0xFF])); // JPEG magic bytes
    }

    #[test]
    fn test_generate_image_dry_run() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("dry_run.png");

        let node = SchemaNode {
            node_type: "file".to_string(),
            name: "dry_run.png".to_string(),
            generate: Some("image".to_string()),
            ..Default::default()
        };

        let vars = HashMap::new();
        generate_image(&node, &path, &vars, true).unwrap();

        // File should NOT be created in dry run mode
        assert!(!path.exists());
    }

    #[test]
    fn test_generate_image_with_variables() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("var_test.png");

        let node = SchemaNode {
            node_type: "file".to_string(),
            name: "var_test.png".to_string(),
            generate: Some("image".to_string()),
            generate_config: Some(r##"width="%WIDTH%" height="%HEIGHT%" background="%COLOR%""##.to_string()),
            ..Default::default()
        };

        let mut vars = HashMap::new();
        vars.insert("%WIDTH%".to_string(), "64".to_string());
        vars.insert("%HEIGHT%".to_string(), "32".to_string());
        vars.insert("%COLOR%".to_string(), "#0000FF".to_string());

        generate_image(&node, &path, &vars, false).unwrap();

        assert!(path.exists());
    }

    #[test]
    fn test_generate_image_default_config() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("default.png");

        let node = SchemaNode {
            node_type: "file".to_string(),
            name: "default.png".to_string(),
            generate: Some("image".to_string()),
            ..Default::default()
        };

        let vars = HashMap::new();
        generate_image(&node, &path, &vars, false).unwrap();

        assert!(path.exists());
    }
}
