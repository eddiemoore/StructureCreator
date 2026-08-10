//! Variable-map completion — the edge step every caller of `plan::expand`
//! runs first (ADR-0004).
//!
//! A Variable map is *complete* when every Built-in Variable has a value and
//! every key is a Variable token (`%NAME%`). Completion is pure: the caller
//! supplies the wall-clock time, so the golden-vector contract can pin it at a
//! fixed instant and `expand` stays deterministic.
//!
//! Keys are Variable tokens on both sides here. The Tauri adapter tokenizes at
//! the IPC seam (ADR-0001), so the native Target never sees clean names.

use std::collections::HashMap;

use chrono::NaiveDateTime;

/// Complete a Variable map: inject the Built-in Variables, then let
/// user-supplied Variables override them.
///
/// `%PROJECT_NAME%` is injected only when a project name is supplied; the
/// user's own `%PROJECT_NAME%` still wins over it.
pub fn complete(
    variables: &HashMap<String, String>,
    project_name: Option<&str>,
    now: NaiveDateTime,
) -> HashMap<String, String> {
    let mut completed = HashMap::new();

    completed.insert("%DATE%".to_string(), now.format("%Y-%m-%d").to_string());
    completed.insert("%YEAR%".to_string(), now.format("%Y").to_string());
    completed.insert("%MONTH%".to_string(), now.format("%m").to_string());
    completed.insert("%DAY%".to_string(), now.format("%d").to_string());

    if let Some(name) = project_name {
        completed.insert("%PROJECT_NAME%".to_string(), name.to_string());
    }

    // User-provided Variables override Built-in Variables.
    for (key, value) in variables.iter() {
        completed.insert(key.clone(), value.clone());
    }

    completed
}

/// The current wall-clock time in the machine's local zone — the instant every
/// production caller of [`complete`] passes.
pub fn now_local() -> NaiveDateTime {
    chrono::Local::now().naive_local()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").expect("valid wall-clock time")
    }

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn injects_every_built_in_variable() {
        let completed = complete(&HashMap::new(), Some("my-project"), at("2026-08-10T14:30:00"));

        assert_eq!(completed.get("%DATE%").unwrap(), "2026-08-10");
        assert_eq!(completed.get("%YEAR%").unwrap(), "2026");
        assert_eq!(completed.get("%MONTH%").unwrap(), "08");
        assert_eq!(completed.get("%DAY%").unwrap(), "10");
        assert_eq!(completed.get("%PROJECT_NAME%").unwrap(), "my-project");
    }

    #[test]
    fn zero_pads_month_and_day() {
        let completed = complete(&HashMap::new(), None, at("2026-03-05T09:00:00"));

        assert_eq!(completed.get("%MONTH%").unwrap(), "03");
        assert_eq!(completed.get("%DAY%").unwrap(), "05");
        assert_eq!(completed.get("%DATE%").unwrap(), "2026-03-05");
    }

    #[test]
    fn omits_project_name_when_absent() {
        let completed = complete(&HashMap::new(), None, at("2026-08-10T14:30:00"));

        assert!(!completed.contains_key("%PROJECT_NAME%"));
    }

    #[test]
    fn user_variables_override_built_ins() {
        let completed = complete(
            &vars(&[("%DATE%", "custom-date"), ("%PROJECT_NAME%", "mine")]),
            Some("supplied"),
            at("2026-08-10T14:30:00"),
        );

        assert_eq!(completed.get("%DATE%").unwrap(), "custom-date");
        assert_eq!(completed.get("%PROJECT_NAME%").unwrap(), "mine");
    }

    #[test]
    fn keeps_user_variables_alongside_built_ins() {
        let completed = complete(&vars(&[("%NAME%", "widget")]), None, at("2026-08-10T14:30:00"));

        assert_eq!(completed.get("%NAME%").unwrap(), "widget");
        assert_eq!(completed.get("%YEAR%").unwrap(), "2026");
    }

    // Golden-vector contract (ADR-0002): pins the Built-in Variable name set,
    // their formats, and the user-override rule across both Targets.
    #[test]
    fn test_builtins_match_golden_contract() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            now: String,
            #[serde(rename = "projectName")]
            project_name: Option<String>,
            variables: HashMap<String, String>,
            expected: HashMap<String, String>,
        }

        let fixture = include_str!("../../../../fixtures/builtins.json");
        let cases: Vec<Case> = serde_json::from_str(fixture).expect("valid fixture JSON");
        assert!(!cases.is_empty(), "builtins fixture must contain cases");

        for case in cases {
            let got = complete(&case.variables, case.project_name.as_deref(), at(&case.now));
            assert_eq!(
                got, case.expected,
                "complete() case {:?}: expected {:?}, got {:?}",
                case.name, case.expected, got
            );
        }
    }
}
