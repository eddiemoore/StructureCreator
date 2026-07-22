//! Pure Plan expansion (ADR-0004).
//!
//! Turns a Schema tree plus a complete variable map into the Plan: the tree
//! of resolved nodes that structure creation executes and diff preview
//! compares against disk. No filesystem, network, or clock access — built-in
//! variables are injected by the caller.

use std::collections::HashMap;

use crate::schema::{SchemaNode, SchemaTree};
use crate::templating;
use crate::transforms::substitute_variables;

/// Maximum allowed repeat count to prevent accidental resource exhaustion
pub const MAX_REPEAT_COUNT: usize = 10000;

/// How a planned file gets its bytes.
#[derive(Debug, Clone, PartialEq)]
pub enum PlanContent {
    /// Fully rendered content (templating then substitution already applied).
    /// `had_content` records whether the schema node carried any content at
    /// all, which execution logging distinguishes from rendered-empty.
    Inline { text: String, had_content: bool },
    /// Download at execution time. Downloaded bytes are still variable-
    /// substituted / binary-processed by the executor (impure input).
    Download { url: String },
    /// Produce via a generator; the schema node carries the generator config.
    Generate { node: SchemaNode },
}

/// Which decisions put a node in the Plan (diff display provenance).
#[derive(Debug, Clone, PartialEq)]
pub enum Provenance {
    If { var: String },
    Else { var: String },
    Repeat {
        var: String,
        iteration: usize,
        count: usize,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum PlanKind {
    Folder { children: Vec<PlanNode> },
    File { content: PlanContent },
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanNode {
    /// Resolved (variable-substituted) name.
    pub name: String,
    pub kind: PlanKind,
    /// Decision chain from the schema root down to this node.
    pub provenance: Vec<Provenance>,
}

/// Expansion-time facts the executor turns into log entries.
#[derive(Debug, Clone, PartialEq)]
pub enum PlanNote {
    /// Loud error: the offending block was skipped.
    Error { message: String, details: String },
    Warning {
        message: String,
        details: Option<String>,
    },
    Info {
        message: String,
        details: Option<String>,
    },
    /// A repeat block expanded; the executor phrases this per dry-run mode.
    RepeatExpanded { count: usize, as_var: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// Top-level resolved nodes. A schema whose root is a folder or file has
    /// exactly one; a root-level if/repeat can yield zero or many.
    pub roots: Vec<PlanNode>,
    pub notes: Vec<PlanNote>,
}

impl Plan {
    pub fn error_count(&self) -> usize {
        self.notes
            .iter()
            .filter(|n| matches!(n, PlanNote::Error { .. }))
            .count()
    }
}

/// Expand a Schema tree into a Plan. `variables` must be complete (built-ins
/// already injected); keys are variable tokens (`%NAME%`).
pub fn expand(tree: &SchemaTree, variables: &HashMap<String, String>) -> Plan {
    let mut notes = Vec::new();
    let mut roots = Vec::new();
    expand_children(
        std::slice::from_ref(&tree.root),
        variables,
        &[],
        &mut roots,
        &mut notes,
    );
    Plan { roots, notes }
}

/// Flatten a Plan to relative slash-joined paths (the contract-test surface).
pub fn to_paths(plan: &Plan) -> Vec<String> {
    let mut out = Vec::new();
    for root in &plan.roots {
        collect_paths(root, "", &mut out);
    }
    out
}

fn collect_paths(node: &PlanNode, prefix: &str, out: &mut Vec<String>) {
    let path = if prefix.is_empty() {
        node.name.clone()
    } else {
        format!("{}/{}", prefix, node.name)
    };
    out.push(path.clone());
    if let PlanKind::Folder { children } = &node.kind {
        for child in children {
            collect_paths(child, &path, out);
        }
    }
}

fn evaluate_if_condition(node: &SchemaNode, variables: &HashMap<String, String>) -> bool {
    if let Some(var_name) = &node.condition_var {
        let lookup_key = format!("%{}%", var_name);
        variables
            .get(&lookup_key)
            .map(|v| crate::transforms::is_truthy_value(v))
            .unwrap_or(false)
    } else {
        false
    }
}

fn expand_children(
    children: &[SchemaNode],
    variables: &HashMap<String, String>,
    provenance: &[Provenance],
    out: &mut Vec<PlanNode>,
    notes: &mut Vec<PlanNote>,
) {
    // Track the most recent `if` result so a sibling `else` knows whether to
    // emit. Any other node type breaks the chain.
    let mut last_if: Option<(String, bool)> = None;

    for child in children {
        match child.node_type.as_str() {
            "if" => {
                let var = child.condition_var.clone().unwrap_or_default();
                let met = evaluate_if_condition(child, variables);
                if met {
                    if let Some(kids) = &child.children {
                        let chain = with_provenance(provenance, Provenance::If { var: var.clone() });
                        expand_children(kids, variables, &chain, out, notes);
                    }
                }
                last_if = Some((var, met));
            }
            "else" => match last_if.take() {
                Some((var, was_true)) => {
                    if !was_true {
                        if let Some(kids) = &child.children {
                            let chain = with_provenance(provenance, Provenance::Else { var });
                            expand_children(kids, variables, &chain, out, notes);
                        }
                    }
                }
                None => {
                    notes.push(PlanNote::Warning {
                        message: "Skipped orphaned else block (no preceding if)".to_string(),
                        details: Some(
                            "Else blocks must immediately follow an if block".to_string(),
                        ),
                    });
                }
            },
            "repeat" => {
                expand_repeat(child, variables, provenance, out, notes);
                last_if = None;
            }
            _ => {
                if let Some(node) = expand_node(child, variables, provenance, notes) {
                    out.push(node);
                }
                last_if = None;
            }
        }
    }
}

fn expand_repeat(
    node: &SchemaNode,
    variables: &HashMap<String, String>,
    provenance: &[Provenance],
    out: &mut Vec<PlanNode>,
    notes: &mut Vec<PlanNote>,
) {
    let count_str = node.repeat_count.as_deref().unwrap_or("1");
    let as_var = node.repeat_as.as_deref().unwrap_or("i");

    // Validate 'as' variable name: non-empty, alphanumeric/underscore only,
    // must not start with a digit.
    let first_char = as_var.chars().next();
    if as_var.is_empty()
        || !as_var.chars().all(|c| c.is_alphanumeric() || c == '_')
        || first_char.map_or(false, |c| c.is_ascii_digit())
    {
        notes.push(PlanNote::Error {
            message: format!("Invalid repeat variable name: '{}'", as_var),
            details: "Variable name must be non-empty, start with a letter or underscore, and contain only alphanumeric characters or underscores".to_string(),
        });
        return;
    }

    // Since %var_1% is the 1-indexed version, %n_1% would create %n_1% and %n_1_1%
    if as_var.ends_with("_1") {
        notes.push(PlanNote::Warning {
            message: format!(
                "Variable name '{}' ends with '_1' which may be confusing",
                as_var
            ),
            details: Some(format!(
                "The 1-indexed variable will be '%{}_1%'. Consider using a different name.",
                as_var
            )),
        });
    }

    let resolved = substitute_variables(count_str, variables);
    let count: usize = match resolved.trim().parse::<i64>() {
        Ok(n) if n < 0 => {
            notes.push(PlanNote::Error {
                message: format!("Repeat count cannot be negative: '{}'", resolved),
                details: format!(
                    "Count must be a non-negative integer (resolved from '{}')",
                    count_str
                ),
            });
            return;
        }
        Ok(n) if n as u64 > MAX_REPEAT_COUNT as u64 => {
            notes.push(PlanNote::Error {
                message: format!("Repeat count '{}' exceeds maximum of {}", n, MAX_REPEAT_COUNT),
                details: "Consider reducing the count or splitting into multiple repeat blocks"
                    .to_string(),
            });
            return;
        }
        Ok(n) => n as usize,
        Err(_) => {
            notes.push(PlanNote::Error {
                message: format!("Invalid repeat count: '{}'", resolved),
                details: format!(
                    "Count must be a non-negative integer (resolved from '{}')",
                    count_str
                ),
            });
            return;
        }
    };

    if count == 0 {
        let details = if count_str == "0" {
            "Count is explicitly set to 0".to_string()
        } else {
            format!("Count '{}' resolved to 0", count_str)
        };
        notes.push(PlanNote::Info {
            message: "Skipping repeat block (count is 0)".to_string(),
            details: Some(details),
        });
        return;
    }

    notes.push(PlanNote::RepeatExpanded {
        count,
        as_var: as_var.to_string(),
    });

    if let Some(children) = &node.children {
        let mut scoped_vars = variables.clone();
        let var_0_key = format!("%{}%", as_var);
        let var_1_key = format!("%{}_1%", as_var);

        for i in 0..count {
            scoped_vars.insert(var_0_key.clone(), i.to_string());
            scoped_vars.insert(var_1_key.clone(), (i + 1).to_string());
            let chain = with_provenance(
                provenance,
                Provenance::Repeat {
                    var: as_var.to_string(),
                    iteration: i,
                    count,
                },
            );
            expand_children(children, &scoped_vars, &chain, out, notes);
        }
    }
}

fn expand_node(
    node: &SchemaNode,
    variables: &HashMap<String, String>,
    provenance: &[Provenance],
    notes: &mut Vec<PlanNote>,
) -> Option<PlanNode> {
    let name = substitute_variables(&node.name, variables);

    match node.node_type.as_str() {
        "folder" => {
            let mut children = Vec::new();
            if let Some(kids) = &node.children {
                expand_children(kids, variables, &[], &mut children, notes);
            }
            Some(PlanNode {
                name,
                kind: PlanKind::Folder { children },
                provenance: provenance.to_vec(),
            })
        }
        "file" => {
            let content = if let Some(url) = &node.url {
                PlanContent::Download {
                    url: substitute_variables(url, variables),
                }
            } else if node.generate.is_some() {
                PlanContent::Generate { node: node.clone() }
            } else {
                let had_content = node.content.is_some();
                let raw = node.content.clone().unwrap_or_default();
                let text = if node.template == Some(true) {
                    match templating::process_template(&raw, variables) {
                        Ok(processed) => substitute_variables(&processed, variables),
                        Err(e) => {
                            notes.push(PlanNote::Warning {
                                message: format!("Template error in {}", name),
                                details: Some(e.to_string()),
                            });
                            substitute_variables(&raw, variables)
                        }
                    }
                } else {
                    substitute_variables(&raw, variables)
                };
                PlanContent::Inline { text, had_content }
            };
            Some(PlanNode {
                name,
                kind: PlanKind::File { content },
                provenance: provenance.to_vec(),
            })
        }
        _ => None,
    }
}

fn with_provenance(chain: &[Provenance], next: Provenance) -> Vec<Provenance> {
    let mut out = chain.to_vec();
    out.push(next);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{SchemaNode, SchemaStats, SchemaTree};

    fn tree(root: SchemaNode) -> SchemaTree {
        SchemaTree {
            root,
            stats: SchemaStats::default(),
            hooks: None,
            variable_definitions: None,
        }
    }

    fn folder(name: &str, children: Vec<SchemaNode>) -> SchemaNode {
        SchemaNode {
            name: name.to_string(),
            node_type: "folder".to_string(),
            children: Some(children),
            ..Default::default()
        }
    }

    fn file(name: &str) -> SchemaNode {
        SchemaNode {
            name: name.to_string(),
            node_type: "file".to_string(),
            ..Default::default()
        }
    }

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn resolves_names_and_renders_inline_content() {
        let mut f = file("%NAME%.txt");
        f.content = Some("Hello %NAME%".to_string());
        let t = tree(folder("%NAME%", vec![f]));
        let plan = expand(&t, &vars(&[("%NAME%", "demo")]));

        assert_eq!(to_paths(&plan), vec!["demo", "demo/demo.txt"]);
        let root = &plan.roots[0];
        let PlanKind::Folder { children } = &root.kind else {
            panic!("root should be folder")
        };
        let PlanKind::File { content } = &children[0].kind else {
            panic!("child should be file")
        };
        assert_eq!(
            content,
            &PlanContent::Inline {
                text: "Hello demo".to_string(),
                had_content: true
            }
        );
    }

    #[test]
    fn template_content_is_processed_then_substituted() {
        let mut f = file("out.txt");
        f.content = Some("{{if FLAG}}on %NAME%{{endif}}".to_string());
        f.template = Some(true);
        let t = tree(folder("root", vec![f]));
        let plan = expand(&t, &vars(&[("%FLAG%", "true"), ("%NAME%", "x")]));

        let PlanKind::Folder { children } = &plan.roots[0].kind else {
            panic!()
        };
        let PlanKind::File { content } = &children[0].kind else {
            panic!()
        };
        let PlanContent::Inline { text, .. } = content else {
            panic!()
        };
        assert_eq!(text, "on x");
    }

    #[test]
    fn url_becomes_download_instruction_with_variables_resolved() {
        let mut f = file("logo.png");
        f.url = Some("https://example.com/%VERSION%/a%20b/%NOPE%/logo.png".to_string());
        let t = tree(folder("root", vec![f]));
        let plan = expand(&t, &vars(&[("%VERSION%", "1.2.3")]));

        let PlanKind::Folder { children } = &plan.roots[0].kind else {
            panic!()
        };
        // Defined tokens resolve; percent-encoding and undefined tokens
        // stay untouched (issue #133).
        assert!(matches!(
            &children[0].kind,
            PlanKind::File {
                content: PlanContent::Download { url }
            } if url == "https://example.com/1.2.3/a%20b/%NOPE%/logo.png"
        ));
    }

    #[test]
    fn generator_becomes_generate_instruction() {
        let mut f = file("db.sqlite");
        f.generate = Some("sqlite".to_string());
        let t = tree(folder("root", vec![f]));
        let plan = expand(&t, &HashMap::new());

        let PlanKind::Folder { children } = &plan.roots[0].kind else {
            panic!()
        };
        assert!(matches!(
            &children[0].kind,
            PlanKind::File {
                content: PlanContent::Generate { .. }
            }
        ));
    }

    #[test]
    fn if_else_selects_branch_and_records_provenance() {
        let mut if_node = SchemaNode {
            node_type: "if".to_string(),
            condition_var: Some("FLAG".to_string()),
            children: Some(vec![file("yes.txt")]),
            ..Default::default()
        };
        if_node.name = String::new();
        let else_node = SchemaNode {
            node_type: "else".to_string(),
            children: Some(vec![file("no.txt")]),
            ..Default::default()
        };
        let t = tree(folder("root", vec![if_node, else_node]));

        let taken = expand(&t, &vars(&[("%FLAG%", "yes")]));
        assert_eq!(to_paths(&taken), vec!["root", "root/yes.txt"]);

        let not_taken = expand(&t, &HashMap::new());
        assert_eq!(to_paths(&not_taken), vec!["root", "root/no.txt"]);
        let PlanKind::Folder { children } = &not_taken.roots[0].kind else {
            panic!()
        };
        assert_eq!(
            children[0].provenance,
            vec![Provenance::Else {
                var: "FLAG".to_string()
            }]
        );
    }

    #[test]
    fn falsy_values_include_no_off_disabled() {
        for falsy in ["no", "off", "disabled", "false", "0", ""] {
            let if_node = SchemaNode {
                node_type: "if".to_string(),
                condition_var: Some("FLAG".to_string()),
                children: Some(vec![file("yes.txt")]),
                ..Default::default()
            };
            let t = tree(folder("root", vec![if_node]));
            let plan = expand(&t, &vars(&[("%FLAG%", falsy)]));
            assert_eq!(to_paths(&plan), vec!["root"], "'{}' should be falsy", falsy);
        }
    }

    #[test]
    fn repeat_expands_with_both_iteration_variables_and_provenance() {
        let repeat = SchemaNode {
            node_type: "repeat".to_string(),
            repeat_count: Some("2".to_string()),
            repeat_as: Some("n".to_string()),
            children: Some(vec![file("item-%n%-of-%n_1%.txt")]),
            ..Default::default()
        };
        let t = tree(folder("root", vec![repeat]));
        let plan = expand(&t, &HashMap::new());

        assert_eq!(
            to_paths(&plan),
            vec!["root", "root/item-0-of-1.txt", "root/item-1-of-2.txt"]
        );
        assert!(plan
            .notes
            .iter()
            .any(|n| matches!(n, PlanNote::RepeatExpanded { count: 2, as_var } if as_var == "n")));
        let PlanKind::Folder { children } = &plan.roots[0].kind else {
            panic!()
        };
        assert_eq!(
            children[1].provenance,
            vec![Provenance::Repeat {
                var: "n".to_string(),
                iteration: 1,
                count: 2
            }]
        );
    }

    #[test]
    fn repeat_edge_errors_skip_block_loudly() {
        for (count, expected_fragment) in [
            ("-2", "cannot be negative"),
            ("banana", "Invalid repeat count"),
            ("10001", "exceeds maximum"),
        ] {
            let repeat = SchemaNode {
                node_type: "repeat".to_string(),
                repeat_count: Some(count.to_string()),
                repeat_as: Some("i".to_string()),
                children: Some(vec![file("item-%i%.txt")]),
                ..Default::default()
            };
            let t = tree(folder("root", vec![repeat]));
            let plan = expand(&t, &HashMap::new());
            assert_eq!(to_paths(&plan), vec!["root"], "count '{}'", count);
            assert_eq!(plan.error_count(), 1, "count '{}'", count);
            assert!(
                plan.notes.iter().any(|n| matches!(
                    n,
                    PlanNote::Error { message, .. } if message.contains(expected_fragment)
                )),
                "count '{}' should mention '{}'",
                count,
                expected_fragment
            );
        }
    }

    #[test]
    fn expansion_is_deterministic() {
        let repeat = SchemaNode {
            node_type: "repeat".to_string(),
            repeat_count: Some("3".to_string()),
            repeat_as: Some("i".to_string()),
            children: Some(vec![file("f-%i%.txt")]),
            ..Default::default()
        };
        let t = tree(folder("root", vec![repeat]));
        let v = vars(&[("%NAME%", "x")]);
        assert_eq!(expand(&t, &v), expand(&t, &v));
    }
}
