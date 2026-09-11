use crate::solid::{Point3, SolidMesh};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const KJD_SCHEMA: &str = "com.kanjie.kjdraw.document";
pub const KJD_SCHEMA_VERSION: u64 = 1;

const REQUIRED_TABLES: [&str; 7] = [
    "layers",
    "linetypes",
    "textStyles",
    "dimensionStyles",
    "ucs",
    "views",
    "blockRecords",
];

const OBJECT_KINDS: [&str; 9] = [
    "entity",
    "table-record",
    "block-record",
    "layout",
    "dictionary",
    "xrecord",
    "group",
    "custom",
    "proxy",
];

/// Dependency-free JSON value used by the KJD file intermediate model.
/// BTreeMap makes emitted KJD deterministic on native and WASM targets.
#[derive(Clone, Debug, PartialEq)]
pub enum CadValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<CadValue>),
    Object(BTreeMap<String, CadValue>),
}

impl Default for CadValue {
    fn default() -> Self {
        Self::Null
    }
}

impl CadValue {
    pub fn object() -> Self {
        Self::Object(BTreeMap::new())
    }
    pub fn array() -> Self {
        Self::Array(Vec::new())
    }
    pub fn as_object(&self) -> Option<&BTreeMap<String, CadValue>> {
        if let Self::Object(value) = self {
            Some(value)
        } else {
            None
        }
    }
    pub fn as_object_mut(&mut self) -> Option<&mut BTreeMap<String, CadValue>> {
        if let Self::Object(value) = self {
            Some(value)
        } else {
            None
        }
    }
    pub fn as_array(&self) -> Option<&[CadValue]> {
        if let Self::Array(value) = self {
            Some(value)
        } else {
            None
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        if let Self::String(value) = self {
            Some(value)
        } else {
            None
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        if let Self::Bool(value) = self {
            Some(*value)
        } else {
            None
        }
    }
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Self::Number(value)
                if value.is_finite()
                    && *value >= 0.0
                    && value.fract() == 0.0
                    && *value <= u64::MAX as f64 =>
            {
                Some(*value as u64)
            }
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Number(value) if value.is_finite() => Some(*value),
            _ => None,
        }
    }
    pub fn get(&self, key: &str) -> Option<&CadValue> {
        self.as_object()?.get(key)
    }
    pub fn to_json(&self) -> Result<String, CadModelError> {
        let mut output = String::new();
        write_json(self, &mut output)?;
        Ok(output)
    }
    pub fn parse_json(input: &str) -> Result<Self, CadModelError> {
        JsonParser::new(input).parse()
    }
}

impl From<&str> for CadValue {
    fn from(value: &str) -> Self {
        Self::String(value.to_owned())
    }
}

impl From<String> for CadValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<bool> for CadValue {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

impl From<u64> for CadValue {
    fn from(value: u64) -> Self {
        Self::Number(value as f64)
    }
}

impl From<usize> for CadValue {
    fn from(value: usize) -> Self {
        Self::Number(value as f64)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}

impl ValidationIssue {
    fn new(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum CadModelError {
    Json { offset: usize, message: String },
    InvalidDocument(Vec<ValidationIssue>),
    RevisionConflict { expected: u64, actual: u64 },
    DuplicateObject(String),
    MissingObject(String),
    InvalidOperation(String),
}

impl fmt::Display for CadModelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json { offset, message } => {
                write!(formatter, "invalid JSON at byte {offset}: {message}")
            }
            Self::InvalidDocument(issues) => write!(
                formatter,
                "invalid KJD document ({} issue(s))",
                issues.len()
            ),
            Self::RevisionConflict { expected, actual } => write!(
                formatter,
                "revision conflict: expected {expected}, actual {actual}"
            ),
            Self::DuplicateObject(id) => write!(formatter, "object already exists: {id}"),
            Self::MissingObject(id) => write!(formatter, "object does not exist: {id}"),
            Self::InvalidOperation(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for CadModelError {}

#[derive(Clone, Debug, PartialEq)]
pub struct CadObject {
    pub id: String,
    pub handle: String,
    pub kind: String,
    pub object_type: String,
    pub owner_id: Option<String>,
    pub name: Option<String>,
    pub payload: CadValue,
    pub extension: CadValue,
    pub erased: bool,
    pub source: CadValue,
    pub extra: BTreeMap<String, CadValue>,
}

impl CadObject {
    pub fn new(
        id: impl Into<String>,
        kind: impl Into<String>,
        object_type: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            handle: String::new(),
            kind: kind.into(),
            object_type: object_type.into().to_ascii_uppercase(),
            owner_id: None,
            name: None,
            payload: CadValue::object(),
            extension: CadValue::Object(BTreeMap::from([
                ("hyperlinks".to_owned(), CadValue::array()),
                ("reactorIds".to_owned(), CadValue::array()),
                ("xdata".to_owned(), CadValue::object()),
                ("xrecordIds".to_owned(), CadValue::array()),
            ])),
            erased: false,
            source: CadValue::Null,
            extra: BTreeMap::new(),
        }
    }

    fn from_value(value: CadValue, path: &str) -> Result<Self, CadModelError> {
        let mut object = expect_object(value, path)?;
        let id = take_string(&mut object, "id", path)?;
        let handle = take_string(&mut object, "handle", path)?.to_ascii_uppercase();
        let kind = take_string(&mut object, "kind", path)?;
        let object_type = take_string(&mut object, "type", path)?.to_ascii_uppercase();
        let owner_id = take_optional_string(&mut object, "ownerId", path)?;
        let name = take_optional_string(&mut object, "name", path)?;
        let payload = object.remove("payload").unwrap_or_else(CadValue::object);
        let extension = object.remove("extension").unwrap_or_else(CadValue::object);
        let erased = match object.remove("erased") {
            Some(CadValue::Bool(value)) => value,
            Some(_) => return Err(json_shape(path, "erased must be a boolean")),
            None => false,
        };
        let source = object.remove("source").unwrap_or(CadValue::Null);
        Ok(Self {
            id,
            handle,
            kind,
            object_type,
            owner_id,
            name,
            payload,
            extension,
            erased,
            source,
            extra: object,
        })
    }

    fn to_value(&self) -> CadValue {
        let mut value = self.extra.clone();
        value.insert("id".to_owned(), self.id.clone().into());
        value.insert("handle".to_owned(), self.handle.clone().into());
        value.insert("kind".to_owned(), self.kind.clone().into());
        value.insert("type".to_owned(), self.object_type.clone().into());
        value.insert(
            "ownerId".to_owned(),
            self.owner_id
                .clone()
                .map(CadValue::String)
                .unwrap_or(CadValue::Null),
        );
        value.insert(
            "name".to_owned(),
            self.name
                .clone()
                .map(CadValue::String)
                .unwrap_or(CadValue::Null),
        );
        value.insert("payload".to_owned(), self.payload.clone());
        value.insert("extension".to_owned(), self.extension.clone());
        value.insert("erased".to_owned(), self.erased.into());
        value.insert("source".to_owned(), self.source.clone());
        CadValue::Object(value)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CadTable {
    pub record_ids: Vec<String>,
    pub current_id: Option<String>,
    pub extra: BTreeMap<String, CadValue>,
}

impl CadTable {
    fn from_value(value: CadValue, path: &str) -> Result<Self, CadModelError> {
        let mut table = expect_object(value, path)?;
        let record_ids = take_string_array(&mut table, "recordIds", path)?;
        let current_id = take_optional_string(&mut table, "currentId", path)?;
        Ok(Self {
            record_ids,
            current_id,
            extra: table,
        })
    }

    fn to_value(&self) -> CadValue {
        let mut value = self.extra.clone();
        value.insert("recordIds".to_owned(), string_array(&self.record_ids));
        value.insert(
            "currentId".to_owned(),
            self.current_id
                .clone()
                .map(CadValue::String)
                .unwrap_or(CadValue::Null),
        );
        CadValue::Object(value)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CadSpaces {
    pub model_space_id: String,
    pub paper_space_ids: Vec<String>,
    pub layout_ids: Vec<String>,
    pub active_layout_id: String,
    pub extra: BTreeMap<String, CadValue>,
}

impl CadSpaces {
    fn from_value(value: CadValue) -> Result<Self, CadModelError> {
        let path = "spaces";
        let mut spaces = expect_object(value, path)?;
        let model_space_id = take_string(&mut spaces, "modelSpaceId", path)?;
        let paper_space_ids = take_string_array(&mut spaces, "paperSpaceIds", path)?;
        let layout_ids = take_string_array(&mut spaces, "layoutIds", path)?;
        let active_layout_id = take_string(&mut spaces, "activeLayoutId", path)?;
        Ok(Self {
            model_space_id,
            paper_space_ids,
            layout_ids,
            active_layout_id,
            extra: spaces,
        })
    }

    fn to_value(&self) -> CadValue {
        let mut value = self.extra.clone();
        value.insert(
            "modelSpaceId".to_owned(),
            self.model_space_id.clone().into(),
        );
        value.insert(
            "paperSpaceIds".to_owned(),
            string_array(&self.paper_space_ids),
        );
        value.insert("layoutIds".to_owned(), string_array(&self.layout_ids));
        value.insert(
            "activeLayoutId".to_owned(),
            self.active_layout_id.clone().into(),
        );
        CadValue::Object(value)
    }
}

/// Canonical KJD intermediate model. Unknown entity payloads, proxy objects,
/// extension dictionaries and source metadata are retained as CadValue.
#[derive(Clone, Debug, PartialEq)]
pub struct CadDocument {
    pub schema: String,
    pub schema_version: u64,
    pub document_id: String,
    pub revision: u64,
    pub header: CadValue,
    pub tables: BTreeMap<String, CadTable>,
    pub spaces: CadSpaces,
    pub named_objects_dictionary_id: String,
    pub objects: BTreeMap<String, CadObject>,
    pub resources: CadValue,
    pub opaque_payloads: CadValue,
    pub revisions: Vec<CadValue>,
    pub metadata: CadValue,
    pub extra: BTreeMap<String, CadValue>,
}

impl CadDocument {
    pub fn from_kjd_json(input: &str) -> Result<Self, CadModelError> {
        let value = CadValue::parse_json(input)?;
        let mut root = expect_object(value, "KJD")?;
        let schema = take_string(&mut root, "schema", "KJD")?;
        let schema_version = take_u64(&mut root, "schemaVersion", "KJD")?;
        let document_id = take_string(&mut root, "documentId", "KJD")?;
        let revision = take_u64(&mut root, "revision", "KJD")?;
        let header = root
            .remove("header")
            .ok_or_else(|| json_shape("KJD.header", "value is required"))?;
        let table_values = expect_object(
            root.remove("tables")
                .ok_or_else(|| json_shape("KJD.tables", "value is required"))?,
            "tables",
        )?;
        let mut tables = BTreeMap::new();
        for (name, value) in table_values {
            tables.insert(
                name.clone(),
                CadTable::from_value(value, &format!("tables.{name}"))?,
            );
        }
        let spaces = CadSpaces::from_value(
            root.remove("spaces")
                .ok_or_else(|| json_shape("KJD.spaces", "value is required"))?,
        )?;
        let named_objects_dictionary_id =
            take_string(&mut root, "namedObjectsDictionaryId", "KJD")?;
        let object_values = expect_object(
            root.remove("objects")
                .ok_or_else(|| json_shape("KJD.objects", "value is required"))?,
            "objects",
        )?;
        let mut objects = BTreeMap::new();
        for (id, value) in object_values {
            let object = CadObject::from_value(value, &format!("objects.{id}"))?;
            objects.insert(id, object);
        }
        let resources = root
            .remove("resources")
            .ok_or_else(|| json_shape("KJD.resources", "value is required"))?;
        let opaque_payloads = root
            .remove("opaquePayloads")
            .unwrap_or_else(CadValue::object);
        let revisions = match root.remove("revisions").unwrap_or_else(CadValue::array) {
            CadValue::Array(value) => value,
            _ => return Err(json_shape("KJD.revisions", "array is required")),
        };
        let metadata = root
            .remove("metadata")
            .ok_or_else(|| json_shape("KJD.metadata", "value is required"))?;
        let document = Self {
            schema,
            schema_version,
            document_id,
            revision,
            header,
            tables,
            spaces,
            named_objects_dictionary_id,
            objects,
            resources,
            opaque_payloads,
            revisions,
            metadata,
            extra: root,
        };
        document.validate()?;
        Ok(document)
    }

    pub fn to_kjd_json(&self) -> Result<String, CadModelError> {
        self.validate()?;
        self.to_value().to_json()
    }

    pub fn to_value(&self) -> CadValue {
        let mut root = self.extra.clone();
        root.insert("schema".to_owned(), self.schema.clone().into());
        root.insert("schemaVersion".to_owned(), self.schema_version.into());
        root.insert("documentId".to_owned(), self.document_id.clone().into());
        root.insert("revision".to_owned(), self.revision.into());
        root.insert("header".to_owned(), self.header.clone());
        root.insert(
            "tables".to_owned(),
            CadValue::Object(
                self.tables
                    .iter()
                    .map(|(name, table)| (name.clone(), table.to_value()))
                    .collect(),
            ),
        );
        root.insert("spaces".to_owned(), self.spaces.to_value());
        root.insert(
            "namedObjectsDictionaryId".to_owned(),
            self.named_objects_dictionary_id.clone().into(),
        );
        root.insert(
            "objects".to_owned(),
            CadValue::Object(
                self.objects
                    .iter()
                    .map(|(id, object)| (id.clone(), object.to_value()))
                    .collect(),
            ),
        );
        root.insert("resources".to_owned(), self.resources.clone());
        root.insert("opaquePayloads".to_owned(), self.opaque_payloads.clone());
        root.insert(
            "revisions".to_owned(),
            CadValue::Array(self.revisions.clone()),
        );
        root.insert("metadata".to_owned(), self.metadata.clone());
        CadValue::Object(root)
    }

    pub fn validate(&self) -> Result<(), CadModelError> {
        let issues = self.validation_issues();
        if issues.is_empty() {
            Ok(())
        } else {
            Err(CadModelError::InvalidDocument(issues))
        }
    }

    pub fn validation_issues(&self) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();
        if self.schema != KJD_SCHEMA {
            issues.push(ValidationIssue::new(
                "schema",
                format!("expected {KJD_SCHEMA}"),
            ));
        }
        if self.schema_version != KJD_SCHEMA_VERSION {
            issues.push(ValidationIssue::new(
                "schemaVersion",
                format!("unsupported schema version: {}", self.schema_version),
            ));
        }
        if self.document_id.trim().is_empty() {
            issues.push(ValidationIssue::new(
                "documentId",
                "document id is required",
            ));
        }
        if self.header.as_object().is_none() {
            issues.push(ValidationIssue::new("header", "object is required"));
        }
        if self.resources.as_object().is_none() {
            issues.push(ValidationIssue::new("resources", "object is required"));
        }
        if self.metadata.as_object().is_none() {
            issues.push(ValidationIssue::new("metadata", "object is required"));
        }

        let mut handles = BTreeMap::<String, String>::new();
        let mut greatest_handle = 0u64;
        for (key, object) in &self.objects {
            let path = format!("objects.{key}");
            if object.id != *key {
                issues.push(ValidationIssue::new(
                    format!("{path}.id"),
                    "object key and id must match",
                ));
            }
            if !OBJECT_KINDS.contains(&object.kind.as_str()) {
                issues.push(ValidationIssue::new(
                    format!("{path}.kind"),
                    format!("unsupported object kind: {}", object.kind),
                ));
            }
            if object.object_type.trim().is_empty() {
                issues.push(ValidationIssue::new(
                    format!("{path}.type"),
                    "object type is required",
                ));
            }
            match parse_handle(&object.handle) {
                Ok(handle) => {
                    greatest_handle = greatest_handle.max(handle);
                    if let Some(other) =
                        handles.insert(object.handle.to_ascii_uppercase(), key.clone())
                    {
                        issues.push(ValidationIssue::new(
                            format!("{path}.handle"),
                            format!("duplicate handle shared with {other}"),
                        ));
                    }
                }
                Err(message) => {
                    issues.push(ValidationIssue::new(format!("{path}.handle"), message))
                }
            }
            if let Some(owner_id) = &object.owner_id {
                if owner_id == key {
                    issues.push(ValidationIssue::new(
                        format!("{path}.ownerId"),
                        "object cannot own itself",
                    ));
                }
                if !self.objects.contains_key(owner_id) {
                    issues.push(ValidationIssue::new(
                        format!("{path}.ownerId"),
                        format!("missing owner: {owner_id}"),
                    ));
                }
            }
            if object.kind == "entity" {
                match object.owner_id.as_ref().and_then(|id| self.objects.get(id)) {
                    Some(owner) if owner.kind == "block-record" => {}
                    _ => issues.push(ValidationIssue::new(
                        format!("{path}.ownerId"),
                        "entity owner must be a block record",
                    )),
                }
                if let Some(layer_id) = object.payload.get("layerId").and_then(CadValue::as_str) {
                    if !self
                        .tables
                        .get("layers")
                        .map(|table| table.record_ids.iter().any(|id| id == layer_id))
                        .unwrap_or(false)
                    {
                        issues.push(ValidationIssue::new(
                            format!("{path}.payload.layerId"),
                            format!("entity layer is not registered: {layer_id}"),
                        ));
                    }
                }
                if object.object_type == "SOLID3D" {
                    if let Err(message) = validate_solid3d_payload(&object.payload) {
                        issues.push(ValidationIssue::new(format!("{path}.payload"), message));
                    }
                }
            }
        }

        match self
            .header
            .get("handseed")
            .and_then(CadValue::as_str)
            .map(parse_handle)
        {
            Some(Ok(handseed)) if handseed > greatest_handle => {}
            Some(Ok(_)) => issues.push(ValidationIssue::new(
                "header.handseed",
                "HANDSEED must be greater than every allocated handle",
            )),
            Some(Err(message)) => issues.push(ValidationIssue::new("header.handseed", message)),
            None => issues.push(ValidationIssue::new(
                "header.handseed",
                "hexadecimal HANDSEED is required",
            )),
        }

        for id in self.objects.keys() {
            let mut visited = BTreeSet::from([id.as_str()]);
            let mut owner_id = self
                .objects
                .get(id)
                .and_then(|object| object.owner_id.as_deref());
            while let Some(owner) = owner_id {
                if !visited.insert(owner) {
                    issues.push(ValidationIssue::new(
                        format!("objects.{id}.ownerId"),
                        "ownership cycle detected",
                    ));
                    break;
                }
                owner_id = self
                    .objects
                    .get(owner)
                    .and_then(|object| object.owner_id.as_deref());
            }
        }

        for name in REQUIRED_TABLES {
            let Some(table) = self.tables.get(name) else {
                issues.push(ValidationIssue::new(
                    format!("tables.{name}"),
                    "required table is missing",
                ));
                continue;
            };
            let mut names = BTreeSet::new();
            for id in &table.record_ids {
                match self.objects.get(id) {
                    Some(record) => {
                        if record.kind != "table-record" && record.kind != "block-record" {
                            issues.push(ValidationIssue::new(
                                format!("tables.{name}.recordIds"),
                                format!("{id} is not a table record"),
                            ));
                        }
                        if let Some(record_name) = &record.name {
                            if !names.insert(record_name.to_ascii_uppercase()) {
                                issues.push(ValidationIssue::new(
                                    format!("tables.{name}.recordIds"),
                                    format!("duplicate record name: {record_name}"),
                                ));
                            }
                        }
                    }
                    None => issues.push(ValidationIssue::new(
                        format!("tables.{name}.recordIds"),
                        format!("missing table record: {id}"),
                    )),
                }
            }
            if let Some(current) = &table.current_id {
                if !table.record_ids.contains(current) {
                    issues.push(ValidationIssue::new(
                        format!("tables.{name}.currentId"),
                        "current record is not in the table",
                    ));
                }
            }
        }

        self.validate_compound_attributes(&mut issues);
        self.validate_spaces(&mut issues);
        issues
    }

    /// Mirror KJD's explicit attached-attribute graph without changing native
    /// containing-space ownership or treating SEQEND as drawable geometry.
    fn validate_compound_attributes(&self, issues: &mut Vec<ValidationIssue>) {
        for object in self.objects.values() {
            let path = format!("objects.{}.payload", object.id);
            if object.kind == "entity" && object.object_type == "INSERT" {
                let ids = match object.payload.get("attributeIds") {
                    None | Some(CadValue::Null) => &[][..],
                    Some(CadValue::Array(ids)) => ids.as_slice(),
                    _ => {
                        issues.push(ValidationIssue::new(
                            format!("{path}.attributeIds"),
                            "INSERT attribute references must be unique ids",
                        ));
                        continue;
                    }
                };
                let mut seen = BTreeSet::new();
                for value in ids {
                    let Some(id) = value.as_str().filter(|id| !id.trim().is_empty()) else {
                        issues.push(ValidationIssue::new(
                            format!("{path}.attributeIds"),
                            "INSERT attribute references must be unique ids",
                        ));
                        continue;
                    };
                    if !seen.insert(id) {
                        issues.push(ValidationIssue::new(
                            format!("{path}.attributeIds"),
                            "INSERT attribute references must be unique ids",
                        ));
                    }
                    let valid = self
                        .objects
                        .get(id)
                        .map(|child| {
                            child.kind == "entity"
                                && child.object_type == "ATTRIB"
                                && child
                                    .payload
                                    .get("parentInsertId")
                                    .and_then(CadValue::as_str)
                                    == Some(object.id.as_str())
                                && child.owner_id == object.owner_id
                                && child.erased == object.erased
                        })
                        .unwrap_or(false);
                    if !valid {
                        issues.push(ValidationIssue::new(
                            format!("{path}.attributeIds"),
                            format!("invalid attached ATTRIB relationship: {id}"),
                        ));
                    }
                }
                let sequence = object
                    .payload
                    .get("sequenceEndId")
                    .filter(|value| **value != CadValue::Null);
                if !ids.is_empty() && sequence.is_none() {
                    issues.push(ValidationIssue::new(
                        format!("{path}.sequenceEndId"),
                        "attached ATTRIB sequence requires SEQEND",
                    ));
                }
                if let Some(sequence) = sequence {
                    let valid = sequence
                        .as_str()
                        .and_then(|id| self.objects.get(id))
                        .map(|end| {
                            end.kind == "custom"
                                && end.object_type == "SEQEND"
                                && end.owner_id.as_deref() == Some(object.id.as_str())
                                && end.erased == object.erased
                        })
                        .unwrap_or(false);
                    if !valid {
                        issues.push(ValidationIssue::new(
                            format!("{path}.sequenceEndId"),
                            "INSERT sequence end is missing or belongs to another insert",
                        ));
                    }
                }
            }
            if object.kind == "entity" && object.object_type == "ATTRIB" {
                if let Some(parent_id) = object
                    .payload
                    .get("parentInsertId")
                    .filter(|value| **value != CadValue::Null)
                {
                    let valid = parent_id
                        .as_str()
                        .and_then(|id| self.objects.get(id))
                        .map(|parent| {
                            parent.kind == "entity"
                                && parent.object_type == "INSERT"
                                && parent.owner_id == object.owner_id
                                && parent.erased == object.erased
                                && parent
                                    .payload
                                    .get("attributeIds")
                                    .and_then(CadValue::as_array)
                                    .map(|ids| {
                                        ids.iter()
                                            .filter(|id| id.as_str() == Some(object.id.as_str()))
                                            .count()
                                            == 1
                                    })
                                    .unwrap_or(false)
                        })
                        .unwrap_or(false);
                    if !valid {
                        issues.push(ValidationIssue::new(format!("{path}.parentInsertId"), "attached ATTRIB requires a unique reciprocal INSERT reference in the same space"));
                    }
                }
            }
            if object.object_type == "SEQEND" {
                let valid = object.kind == "custom"
                    && object
                        .owner_id
                        .as_ref()
                        .and_then(|id| self.objects.get(id))
                        .map(|parent| {
                            parent.kind == "entity"
                                && parent.object_type == "INSERT"
                                && parent
                                    .payload
                                    .get("sequenceEndId")
                                    .and_then(CadValue::as_str)
                                    == Some(object.id.as_str())
                                && parent.erased == object.erased
                        })
                        .unwrap_or(false);
                if !valid {
                    issues.push(ValidationIssue::new(
                        &path,
                        "SEQEND requires a reciprocal INSERT owner",
                    ));
                }
                if !matches!(
                    object
                        .payload
                        .get("dxfOwnerMode")
                        .and_then(CadValue::as_str),
                    Some("insert" | "space")
                ) {
                    issues.push(ValidationIssue::new(
                        format!("{path}.dxfOwnerMode"),
                        "SEQEND native owner mode must be insert or space",
                    ));
                }
                if let Some(layer) = object
                    .payload
                    .get("layerId")
                    .filter(|value| **value != CadValue::Null)
                {
                    let valid = layer
                        .as_str()
                        .map(|id| {
                            self.tables
                                .get("layers")
                                .map(|table| table.record_ids.iter().any(|record| record == id))
                                .unwrap_or(false)
                        })
                        .unwrap_or(false);
                    if !valid {
                        issues.push(ValidationIssue::new(
                            format!("{path}.layerId"),
                            "SEQEND layer is not registered",
                        ));
                    }
                }
            }
        }
    }

    fn validate_spaces(&self, issues: &mut Vec<ValidationIssue>) {
        for id in
            std::iter::once(&self.spaces.model_space_id).chain(self.spaces.paper_space_ids.iter())
        {
            if self.objects.get(id).map(|object| object.kind.as_str()) != Some("block-record") {
                issues.push(ValidationIssue::new(
                    "spaces",
                    format!("space does not reference a block record: {id}"),
                ));
            }
        }
        for id in &self.spaces.layout_ids {
            if self.objects.get(id).map(|object| object.kind.as_str()) != Some("layout") {
                issues.push(ValidationIssue::new(
                    "spaces.layoutIds",
                    format!("layout is missing: {id}"),
                ));
            }
        }
        if !self
            .spaces
            .layout_ids
            .contains(&self.spaces.active_layout_id)
        {
            issues.push(ValidationIssue::new(
                "spaces.activeLayoutId",
                "active layout is not registered",
            ));
        }
        if self
            .objects
            .get(&self.named_objects_dictionary_id)
            .map(|object| object.kind.as_str())
            != Some("dictionary")
        {
            issues.push(ValidationIssue::new(
                "namedObjectsDictionaryId",
                "named objects dictionary is missing",
            ));
        }

        for object in self.objects.values() {
            let path = format!("objects.{}.payload", object.id);
            if object.kind == "block-record" {
                for entity_id in value_string_array(object.payload.get("entityIds")) {
                    let valid = self
                        .objects
                        .get(entity_id)
                        .map(|entity| {
                            entity.kind == "entity"
                                && entity.owner_id.as_deref() == Some(object.id.as_str())
                        })
                        .unwrap_or(false);
                    if !valid {
                        issues.push(ValidationIssue::new(
                            format!("{path}.entityIds"),
                            format!("invalid owned entity: {entity_id}"),
                        ));
                    }
                }
            } else if object.kind == "layout" {
                match object
                    .payload
                    .get("blockRecordId")
                    .and_then(CadValue::as_str)
                    .and_then(|id| self.objects.get(id))
                {
                    Some(record) if record.kind == "block-record" => {}
                    _ => issues.push(ValidationIssue::new(
                        format!("{path}.blockRecordId"),
                        "layout block record is missing",
                    )),
                }
                for viewport_id in value_string_array(object.payload.get("viewportIds")) {
                    if self
                        .objects
                        .get(viewport_id)
                        .map(|viewport| viewport.object_type.as_str())
                        != Some("VIEWPORT")
                    {
                        issues.push(ValidationIssue::new(
                            format!("{path}.viewportIds"),
                            format!("invalid viewport: {viewport_id}"),
                        ));
                    }
                }
            } else if object.kind == "dictionary" {
                if let Some(entries) = object.payload.get("entries").and_then(CadValue::as_object) {
                    for referenced in entries
                        .values()
                        .flat_map(|value| value_string_array(Some(value)))
                    {
                        if !self.objects.contains_key(referenced) {
                            issues.push(ValidationIssue::new(
                                format!("{path}.entries"),
                                format!("dictionary target is missing: {referenced}"),
                            ));
                        }
                    }
                }
            } else if object.kind == "group" {
                for member_id in value_string_array(object.payload.get("memberIds")) {
                    if !self.objects.contains_key(member_id) {
                        issues.push(ValidationIssue::new(
                            format!("{path}.memberIds"),
                            format!("group member is missing: {member_id}"),
                        ));
                    }
                }
            }
        }
    }

    pub fn allocate_handle(&mut self) -> Result<String, CadModelError> {
        let header = self.header.as_object_mut().ok_or_else(|| {
            CadModelError::InvalidOperation("header must be an object".to_owned())
        })?;
        let next = header
            .get("handseed")
            .and_then(CadValue::as_str)
            .ok_or_else(|| {
                CadModelError::InvalidOperation("header.handseed is required".to_owned())
            })
            .and_then(|value| parse_handle(value).map_err(CadModelError::InvalidOperation))?;
        header.insert(
            "handseed".to_owned(),
            format!(
                "{:X}",
                next.checked_add(1)
                    .ok_or_else(|| CadModelError::InvalidOperation(
                        "CAD handle space is exhausted".to_owned()
                    ))?
            )
            .into(),
        );
        Ok(format!("{next:X}"))
    }

    pub fn fingerprint(&self) -> Result<String, CadModelError> {
        let mut value = self.to_value();
        if let Some(root) = value.as_object_mut() {
            root.insert("revision".to_owned(), 0u64.into());
            root.insert("revisions".to_owned(), CadValue::array());
            if let Some(metadata) = root.get_mut("metadata").and_then(CadValue::as_object_mut) {
                metadata.insert("modifiedAt".to_owned(), CadValue::Null);
            }
        }
        let json = value.to_json()?;
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for byte in json.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        Ok(format!("{hash:016x}"))
    }

    /// Accepts a complete KJD candidate as the next authoritative revision.
    /// Clients may prepare edits outside Rust, but they cannot change document
    /// identity, rewrite history, skip revisions or commit an invalid graph.
    pub fn accept_candidate(
        &mut self,
        expected_revision: u64,
        candidate: CadDocument,
    ) -> Result<(), CadModelError> {
        if expected_revision != self.revision {
            return Err(CadModelError::RevisionConflict {
                expected: expected_revision,
                actual: self.revision,
            });
        }
        if candidate.document_id != self.document_id {
            return Err(CadModelError::InvalidOperation(
                "candidate documentId does not match the Rust session".to_owned(),
            ));
        }
        let next_revision = expected_revision.checked_add(1).ok_or_else(|| {
            CadModelError::InvalidOperation("document revision is exhausted".to_owned())
        })?;
        if candidate.revision != next_revision {
            return Err(CadModelError::InvalidOperation(format!(
                "candidate revision must be {next_revision}"
            )));
        }
        if candidate.revisions.len() != self.revisions.len() + 1
            || !candidate.revisions.starts_with(&self.revisions)
        {
            return Err(CadModelError::InvalidOperation(
                "candidate must append exactly one immutable history record".to_owned(),
            ));
        }
        let recorded_revision = candidate
            .revisions
            .last()
            .and_then(|record| record.get("revision"))
            .and_then(CadValue::as_u64);
        if recorded_revision != Some(next_revision) {
            return Err(CadModelError::InvalidOperation(
                "candidate history revision does not match document revision".to_owned(),
            ));
        }
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn transact<R, F>(
        &mut self,
        expected_revision: u64,
        label: &str,
        at: &str,
        source: &str,
        work: F,
    ) -> Result<R, CadModelError>
    where
        F: FnOnce(&mut CadDraft<'_>) -> Result<R, CadModelError>,
    {
        if expected_revision != self.revision {
            return Err(CadModelError::RevisionConflict {
                expected: expected_revision,
                actual: self.revision,
            });
        }
        let mut candidate = self.clone();
        let (result, operations) = {
            let mut draft = CadDraft {
                document: &mut candidate,
                operations: Vec::new(),
            };
            let result = work(&mut draft)?;
            (result, draft.operations)
        };
        candidate.validate()?;
        candidate.revision = candidate.revision.checked_add(1).ok_or_else(|| {
            CadModelError::InvalidOperation("document revision is exhausted".to_owned())
        })?;
        if let Some(metadata) = candidate.metadata.as_object_mut() {
            metadata.insert("modifiedAt".to_owned(), at.into());
        }
        let fingerprint = candidate.fingerprint()?;
        let revision = CadValue::Object(BTreeMap::from([
            ("at".to_owned(), at.into()),
            ("fingerprint".to_owned(), fingerprint.into()),
            ("kind".to_owned(), "commit".into()),
            ("label".to_owned(), label.into()),
            ("operationCount".to_owned(), operations.len().into()),
            ("operations".to_owned(), CadValue::Array(operations)),
            ("revision".to_owned(), candidate.revision.into()),
            ("source".to_owned(), source.into()),
        ]));
        candidate.revisions.push(revision);
        candidate.validate()?;
        *self = candidate;
        Ok(result)
    }
}

pub struct CadDraft<'a> {
    document: &'a mut CadDocument,
    operations: Vec<CadValue>,
}

impl<'a> CadDraft<'a> {
    pub fn document(&self) -> &CadDocument {
        self.document
    }

    pub fn create_object(&mut self, mut object: CadObject) -> Result<(), CadModelError> {
        if self.document.objects.contains_key(&object.id) {
            return Err(CadModelError::DuplicateObject(object.id));
        }
        if object.handle.is_empty() {
            object.handle = self.document.allocate_handle()?;
        }
        if object.kind == "entity" && object.owner_id.is_none() {
            object.owner_id = Some(self.document.spaces.model_space_id.clone());
        }
        let id = object.id.clone();
        let owner_id = object.owner_id.clone();
        let kind = object.kind.clone();
        self.document.objects.insert(id.clone(), object);
        if kind == "entity" {
            let owner = owner_id
                .as_ref()
                .and_then(|owner_id| self.document.objects.get_mut(owner_id))
                .ok_or_else(|| CadModelError::MissingObject(owner_id.unwrap_or_default()))?;
            let payload = owner.payload.as_object_mut().ok_or_else(|| {
                CadModelError::InvalidOperation("block-record payload must be an object".to_owned())
            })?;
            let entity_ids = payload
                .entry("entityIds".to_owned())
                .or_insert_with(CadValue::array);
            let values = match entity_ids {
                CadValue::Array(values) => values,
                _ => {
                    return Err(CadModelError::InvalidOperation(
                        "block-record entityIds must be an array".to_owned(),
                    ))
                }
            };
            values.push(id.clone().into());
        }
        self.operations
            .push(operation("create-object", [("id", id.into())]));
        Ok(())
    }

    pub fn replace_payload(&mut self, id: &str, payload: CadValue) -> Result<(), CadModelError> {
        let object = self
            .document
            .objects
            .get_mut(id)
            .ok_or_else(|| CadModelError::MissingObject(id.to_owned()))?;
        object.payload = payload;
        self.operations
            .push(operation("replace-payload", [("id", id.into())]));
        Ok(())
    }

    pub fn set_erased(&mut self, id: &str, erased: bool) -> Result<(), CadModelError> {
        let object = self
            .document
            .objects
            .get_mut(id)
            .ok_or_else(|| CadModelError::MissingObject(id.to_owned()))?;
        object.erased = erased;
        self.operations.push(operation(
            "set-erased",
            [("id", id.into()), ("erased", erased.into())],
        ));
        Ok(())
    }

    pub fn put_resource(
        &mut self,
        family: &str,
        id: &str,
        value: CadValue,
    ) -> Result<(), CadModelError> {
        let resources = self.document.resources.as_object_mut().ok_or_else(|| {
            CadModelError::InvalidOperation("resources must be an object".to_owned())
        })?;
        let family_value = resources
            .entry(family.to_owned())
            .or_insert_with(CadValue::object);
        let entries = family_value.as_object_mut().ok_or_else(|| {
            CadModelError::InvalidOperation(format!("resource family {family} must be an object"))
        })?;
        entries.insert(id.to_owned(), value);
        self.operations.push(operation(
            "put-resource",
            [("family", family.into()), ("id", id.into())],
        ));
        Ok(())
    }

    pub fn put_opaque_payload(&mut self, id: &str, value: CadValue) -> Result<(), CadModelError> {
        let opaque = self
            .document
            .opaque_payloads
            .as_object_mut()
            .ok_or_else(|| {
                CadModelError::InvalidOperation("opaquePayloads must be an object".to_owned())
            })?;
        opaque.insert(id.to_owned(), value);
        self.operations
            .push(operation("put-opaque-payload", [("id", id.into())]));
        Ok(())
    }
}

fn operation<const N: usize>(kind: &str, values: [(&str, CadValue); N]) -> CadValue {
    let mut object = BTreeMap::from([("type".to_owned(), kind.into())]);
    object.extend(
        values
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value)),
    );
    CadValue::Object(object)
}

fn string_array(values: &[String]) -> CadValue {
    CadValue::Array(values.iter().cloned().map(CadValue::String).collect())
}

fn value_string_array(value: Option<&CadValue>) -> Vec<&str> {
    value
        .and_then(CadValue::as_array)
        .map(|values| values.iter().filter_map(CadValue::as_str).collect())
        .unwrap_or_default()
}

fn validate_solid3d_payload(payload: &CadValue) -> Result<(), String> {
    if payload.get("kernelAuthority").and_then(CadValue::as_str) != Some("kjcore-rust-wasm") {
        return Err("SOLID3D kernelAuthority must be kjcore-rust-wasm".to_owned());
    }
    if payload.get("solidModelVersion").and_then(CadValue::as_u64) != Some(1) {
        return Err("SOLID3D solidModelVersion must be 1".to_owned());
    }
    let vertices = payload
        .get("vertices")
        .and_then(CadValue::as_array)
        .ok_or_else(|| "SOLID3D vertices must be an array".to_owned())?
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let values = row
                .as_array()
                .ok_or_else(|| format!("SOLID3D vertices[{index}] must be an array"))?;
            if values.len() != 3 {
                return Err(format!(
                    "SOLID3D vertices[{index}] must contain three coordinates"
                ));
            }
            Ok(Point3::new(
                values[0]
                    .as_f64()
                    .ok_or_else(|| format!("SOLID3D vertices[{index}][0] must be finite"))?,
                values[1]
                    .as_f64()
                    .ok_or_else(|| format!("SOLID3D vertices[{index}][1] must be finite"))?,
                values[2]
                    .as_f64()
                    .ok_or_else(|| format!("SOLID3D vertices[{index}][2] must be finite"))?,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let triangles = payload
        .get("triangles")
        .and_then(CadValue::as_array)
        .ok_or_else(|| "SOLID3D triangles must be an array".to_owned())?
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let values = row
                .as_array()
                .ok_or_else(|| format!("SOLID3D triangles[{index}] must be an array"))?;
            if values.len() != 3 {
                return Err(format!(
                    "SOLID3D triangles[{index}] must contain three indices"
                ));
            }
            let mut triangle = [0u32; 3];
            for part in 0..3 {
                let value = values[part].as_u64().ok_or_else(|| {
                    format!("SOLID3D triangles[{index}][{part}] must be an unsigned integer")
                })?;
                triangle[part] = u32::try_from(value)
                    .map_err(|_| format!("SOLID3D triangles[{index}][{part}] exceeds u32"))?;
            }
            Ok(triangle)
        })
        .collect::<Result<Vec<_>, String>>()?;
    SolidMesh::from_indexed(vertices, triangles, "kjd-solid3d")
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn parse_handle(value: &str) -> Result<u64, String> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("CAD handle must be a non-empty hexadecimal string".to_owned());
    }
    u64::from_str_radix(value, 16).map_err(|_| "CAD handle exceeds the 64-bit KJD range".to_owned())
}

fn expect_object(value: CadValue, path: &str) -> Result<BTreeMap<String, CadValue>, CadModelError> {
    if let CadValue::Object(value) = value {
        Ok(value)
    } else {
        Err(json_shape(path, "object is required"))
    }
}

fn take_string(
    object: &mut BTreeMap<String, CadValue>,
    key: &str,
    path: &str,
) -> Result<String, CadModelError> {
    match object.remove(key) {
        Some(CadValue::String(value)) => Ok(value),
        _ => Err(json_shape(&format!("{path}.{key}"), "string is required")),
    }
}

fn take_optional_string(
    object: &mut BTreeMap<String, CadValue>,
    key: &str,
    path: &str,
) -> Result<Option<String>, CadModelError> {
    match object.remove(key) {
        Some(CadValue::String(value)) => Ok(Some(value)),
        Some(CadValue::Null) | None => Ok(None),
        _ => Err(json_shape(
            &format!("{path}.{key}"),
            "string or null is required",
        )),
    }
}

fn take_u64(
    object: &mut BTreeMap<String, CadValue>,
    key: &str,
    path: &str,
) -> Result<u64, CadModelError> {
    object
        .remove(key)
        .and_then(|value| value.as_u64())
        .ok_or_else(|| json_shape(&format!("{path}.{key}"), "non-negative integer is required"))
}

fn take_string_array(
    object: &mut BTreeMap<String, CadValue>,
    key: &str,
    path: &str,
) -> Result<Vec<String>, CadModelError> {
    match object.remove(key) {
        Some(CadValue::Array(values)) => values
            .into_iter()
            .map(|value| match value {
                CadValue::String(value) => Ok(value),
                _ => Err(json_shape(
                    &format!("{path}.{key}"),
                    "array must contain only strings",
                )),
            })
            .collect(),
        _ => Err(json_shape(&format!("{path}.{key}"), "array is required")),
    }
}

fn json_shape(path: &str, message: &str) -> CadModelError {
    CadModelError::Json {
        offset: 0,
        message: format!("{path}: {message}"),
    }
}

fn write_json(value: &CadValue, output: &mut String) -> Result<(), CadModelError> {
    match value {
        CadValue::Null => output.push_str("null"),
        CadValue::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        CadValue::Number(value) => {
            if !value.is_finite() {
                return Err(CadModelError::InvalidOperation(
                    "KJD cannot contain non-finite numbers".to_owned(),
                ));
            }
            if *value == 0.0 {
                output.push('0');
            } else {
                output.push_str(&value.to_string());
            }
        }
        CadValue::String(value) => write_json_string(value, output),
        CadValue::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_json(value, output)?;
            }
            output.push(']');
        }
        CadValue::Object(values) => {
            output.push('{');
            for (index, (key, value)) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_json_string(key, output);
                output.push(':');
                write_json(value, output)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn write_json_string(value: &str, output: &mut String) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            value if value <= '\u{1f}' => output.push_str(&format!("\\u{:04x}", value as u32)),
            value => output.push(value),
        }
    }
    output.push('"');
}

struct JsonParser<'a> {
    source: &'a str,
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> JsonParser<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            bytes: source.as_bytes(),
            offset: 0,
        }
    }

    fn parse(mut self) -> Result<CadValue, CadModelError> {
        self.whitespace();
        let value = self.value()?;
        self.whitespace();
        if self.offset != self.bytes.len() {
            return self.error("trailing content");
        }
        Ok(value)
    }

    fn value(&mut self) -> Result<CadValue, CadModelError> {
        match self.peek() {
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(CadValue::Null)
            }
            Some(b't') => {
                self.literal(b"true")?;
                Ok(CadValue::Bool(true))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(CadValue::Bool(false))
            }
            Some(b'"') => self.string().map(CadValue::String),
            Some(b'[') => self.array(),
            Some(b'{') => self.object(),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => self.error("expected a JSON value"),
        }
    }

    fn literal(&mut self, expected: &[u8]) -> Result<(), CadModelError> {
        if self.bytes.get(self.offset..self.offset + expected.len()) == Some(expected) {
            self.offset += expected.len();
            Ok(())
        } else {
            self.error("invalid literal")
        }
    }

    fn array(&mut self) -> Result<CadValue, CadModelError> {
        self.offset += 1;
        self.whitespace();
        let mut values = Vec::new();
        if self.consume(b']') {
            return Ok(CadValue::Array(values));
        }
        loop {
            self.whitespace();
            values.push(self.value()?);
            self.whitespace();
            if self.consume(b']') {
                break;
            }
            if !self.consume(b',') {
                return self.error("expected ',' or ']' in array");
            }
        }
        Ok(CadValue::Array(values))
    }

    fn object(&mut self) -> Result<CadValue, CadModelError> {
        self.offset += 1;
        self.whitespace();
        let mut values = BTreeMap::new();
        if self.consume(b'}') {
            return Ok(CadValue::Object(values));
        }
        loop {
            self.whitespace();
            if self.peek() != Some(b'"') {
                return self.error("object key must be a string");
            }
            let key = self.string()?;
            self.whitespace();
            if !self.consume(b':') {
                return self.error("expected ':' after object key");
            }
            self.whitespace();
            let value = self.value()?;
            if values.insert(key, value).is_some() {
                return self.error("duplicate object key");
            }
            self.whitespace();
            if self.consume(b'}') {
                break;
            }
            if !self.consume(b',') {
                return self.error("expected ',' or '}' in object");
            }
        }
        Ok(CadValue::Object(values))
    }

    fn string(&mut self) -> Result<String, CadModelError> {
        let start = self.offset;
        self.offset += 1;
        let mut output = String::new();
        let mut chunk_start = self.offset;
        loop {
            let Some(byte) = self.peek() else {
                return self.error("unterminated string");
            };
            match byte {
                b'"' => {
                    output.push_str(&self.source[chunk_start..self.offset]);
                    self.offset += 1;
                    return Ok(output);
                }
                b'\\' => {
                    output.push_str(&self.source[chunk_start..self.offset]);
                    self.offset += 1;
                    let escaped = self.next().ok_or_else(|| CadModelError::Json {
                        offset: self.offset,
                        message: "unterminated escape".to_owned(),
                    })?;
                    match escaped {
                        b'"' => output.push('"'),
                        b'\\' => output.push('\\'),
                        b'/' => output.push('/'),
                        b'b' => output.push('\u{08}'),
                        b'f' => output.push('\u{0c}'),
                        b'n' => output.push('\n'),
                        b'r' => output.push('\r'),
                        b't' => output.push('\t'),
                        b'u' => {
                            let first = self.hex_quad()?;
                            let code = if (0xd800..=0xdbff).contains(&first) {
                                if self.next() != Some(b'\\') || self.next() != Some(b'u') {
                                    return self.error(
                                        "high surrogate must be followed by a low surrogate",
                                    );
                                }
                                let second = self.hex_quad()?;
                                if !(0xdc00..=0xdfff).contains(&second) {
                                    return self.error("invalid low surrogate");
                                }
                                0x10000
                                    + ((u32::from(first) - 0xd800) << 10)
                                    + (u32::from(second) - 0xdc00)
                            } else if (0xdc00..=0xdfff).contains(&first) {
                                return self.error("unexpected low surrogate");
                            } else {
                                u32::from(first)
                            };
                            output.push(char::from_u32(code).ok_or_else(|| {
                                CadModelError::Json {
                                    offset: self.offset,
                                    message: "invalid unicode scalar".to_owned(),
                                }
                            })?);
                        }
                        _ => return self.error("unsupported string escape"),
                    }
                    chunk_start = self.offset;
                }
                0x00..=0x1f => return self.error("unescaped control character in string"),
                value if value < 0x80 => self.offset += 1,
                _ => {
                    let character = self.source[self.offset..].chars().next().ok_or_else(|| {
                        CadModelError::Json {
                            offset: start,
                            message: "invalid UTF-8".to_owned(),
                        }
                    })?;
                    self.offset += character.len_utf8();
                }
            }
        }
    }

    fn hex_quad(&mut self) -> Result<u16, CadModelError> {
        let start = self.offset;
        let end = start + 4;
        let digits = self
            .source
            .get(start..end)
            .ok_or_else(|| CadModelError::Json {
                offset: start,
                message: "incomplete unicode escape".to_owned(),
            })?;
        if !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return self.error("invalid unicode escape");
        }
        self.offset = end;
        u16::from_str_radix(digits, 16).map_err(|_| CadModelError::Json {
            offset: start,
            message: "invalid unicode escape".to_owned(),
        })
    }

    fn number(&mut self) -> Result<CadValue, CadModelError> {
        let start = self.offset;
        self.consume(b'-');
        match self.peek() {
            Some(b'0') => {
                self.offset += 1;
                if matches!(self.peek(), Some(b'0'..=b'9')) {
                    return self.error("leading zero in number");
                }
            }
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.offset += 1;
                }
            }
            _ => return self.error("invalid number"),
        }
        if self.consume(b'.') {
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return self.error("fraction requires digits");
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.offset += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.offset += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return self.error("exponent requires digits");
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
        }
        let value = self.source[start..self.offset]
            .parse::<f64>()
            .map_err(|_| CadModelError::Json {
                offset: start,
                message: "invalid number".to_owned(),
            })?;
        if !value.is_finite() {
            return self.error("number is outside the finite f64 range");
        }
        Ok(CadValue::Number(value))
    }

    fn whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.offset += 1;
        }
    }
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.offset).copied()
    }
    fn next(&mut self) -> Option<u8> {
        let value = self.peek()?;
        self.offset += 1;
        Some(value)
    }
    fn consume(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.offset += 1;
            true
        } else {
            false
        }
    }
    fn error<T>(&self, message: &str) -> Result<T, CadModelError> {
        Err(CadModelError::Json {
            offset: self.offset,
            message: message.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        r#"{
          "schema":"com.kanjie.kjdraw.document","schemaVersion":1,"documentId":"drawing-1","revision":0,
          "header":{"handseed":"9","units":"millimeter"},
          "tables":{
            "layers":{"recordIds":["layer:0"],"currentId":"layer:0"},
            "linetypes":{"recordIds":["linetype:continuous"],"currentId":"linetype:continuous"},
            "textStyles":{"recordIds":[],"currentId":null},"dimensionStyles":{"recordIds":[],"currentId":null},
            "ucs":{"recordIds":[],"currentId":null},"views":{"recordIds":[],"currentId":null},
            "blockRecords":{"recordIds":["block:model","block:paper"],"currentId":"block:model"}
          },
          "spaces":{"modelSpaceId":"block:model","paperSpaceIds":["block:paper"],"layoutIds":["layout:model","layout:paper"],"activeLayoutId":"layout:model"},
          "namedObjectsDictionaryId":"dict:nod",
          "objects":{
            "dict:nod":{"id":"dict:nod","handle":"1","kind":"dictionary","type":"DICTIONARY","ownerId":null,"name":"NAMED_OBJECTS","payload":{"entries":{"ACAD_LAYOUT":["layout:model","layout:paper"]}},"extension":{},"erased":false,"source":null},
            "linetype:continuous":{"id":"linetype:continuous","handle":"2","kind":"table-record","type":"LINETYPE","ownerId":null,"name":"CONTINUOUS","payload":{},"extension":{},"erased":false,"source":null},
            "layer:0":{"id":"layer:0","handle":"3","kind":"table-record","type":"LAYER","ownerId":null,"name":"0","payload":{},"extension":{},"erased":false,"source":null},
            "block:model":{"id":"block:model","handle":"4","kind":"block-record","type":"BLOCK_RECORD","ownerId":null,"name":"*MODEL_SPACE","payload":{"entityIds":[]},"extension":{},"erased":false,"source":null},
            "block:paper":{"id":"block:paper","handle":"5","kind":"block-record","type":"BLOCK_RECORD","ownerId":null,"name":"*PAPER_SPACE","payload":{"entityIds":[]},"extension":{},"erased":false,"source":null},
            "layout:model":{"id":"layout:model","handle":"6","kind":"layout","type":"LAYOUT","ownerId":"dict:nod","name":"Model","payload":{"blockRecordId":"block:model","viewportIds":[]},"extension":{},"erased":false,"source":null},
            "layout:paper":{"id":"layout:paper","handle":"7","kind":"layout","type":"LAYOUT","ownerId":"dict:nod","name":"Layout1","payload":{"blockRecordId":"block:paper","viewportIds":[]},"extension":{},"erased":false,"source":null}
          },
          "resources":{},"opaquePayloads":{"dwg:future":{"className":"AcDbFutureObject","bytes":"010203"}},"revisions":[],"metadata":{"title":"中文工程","modifiedAt":"2026-08-22T00:00:00Z"}
        }"#.to_owned()
    }

    #[test]
    fn parses_validates_and_deterministically_reopens_kjd() {
        let document = CadDocument::from_kjd_json(&fixture()).unwrap();
        assert_eq!(document.document_id, "drawing-1");
        let written = document.to_kjd_json().unwrap();
        let reopened = CadDocument::from_kjd_json(&written).unwrap();
        assert_eq!(reopened, document);
        assert!(written.contains("中文工程"));
        assert!(written.contains("AcDbFutureObject"));
    }

    fn attached_fixture(owner_mode: &str, with_attributes: bool) -> CadDocument {
        let mut document = CadDocument::from_kjd_json(&fixture()).unwrap();
        let mut insert = CadObject::new("insert", "entity", "INSERT");
        insert.owner_id = Some("block:model".into());
        insert.payload = CadValue::Object(BTreeMap::from([
            ("blockRecordId".into(), "block:paper".into()),
            (
                "attributeIds".into(),
                CadValue::Array(if with_attributes {
                    vec!["attribute-b".into(), "attribute-a".into()]
                } else {
                    vec![]
                }),
            ),
            ("sequenceEndId".into(), "end".into()),
        ]));
        let mut end = CadObject::new("end", "custom", "SEQEND");
        end.owner_id = Some("insert".into());
        end.payload = CadValue::Object(BTreeMap::from([
            ("dxfOwnerMode".into(), owner_mode.into()),
            ("layerId".into(), "layer:0".into()),
            ("futureNativeData".into(), "retained opaque metadata".into()),
        ]));
        document
            .transact(
                0,
                "Create native attribute sequence",
                "2026-09-11T00:00:00Z",
                "test",
                |draft| {
                    draft.create_object(insert)?;
                    if with_attributes {
                        for id in ["attribute-a", "attribute-b"] {
                            let mut attribute = CadObject::new(id, "entity", "ATTRIB");
                            attribute.owner_id = Some("block:model".into());
                            attribute.payload = CadValue::Object(BTreeMap::from([
                                ("parentInsertId".into(), "insert".into()),
                                ("tag".into(), id.into()),
                                ("text".into(), "Native owner-space text".into()),
                                ("layerId".into(), "layer:0".into()),
                            ]));
                            draft.create_object(attribute)?;
                        }
                    }
                    draft.create_object(end)
                },
            )
            .unwrap();
        document
    }

    fn attribute_field(document: &mut CadDocument, id: &str, key: &str, value: CadValue) {
        document
            .objects
            .get_mut(id)
            .unwrap()
            .payload
            .as_object_mut()
            .unwrap()
            .insert(key.into(), value);
    }

    #[test]
    fn compound_attributes_reopen_preserves_order_owner_modes_and_custom_sequence_metadata() {
        for mode in ["insert", "space"] {
            for with_attributes in [false, true] {
                let mut document = attached_fixture(mode, with_attributes);
                let original = document.clone();
                assert_eq!(
                    CadDocument::from_kjd_json(&document.to_kjd_json().unwrap()).unwrap(),
                    original
                );
                assert_eq!(document.objects["end"].kind, "custom");
                assert_eq!(document.objects["end"].owner_id.as_deref(), Some("insert"));
                if with_attributes {
                    assert_eq!(
                        value_string_array(document.objects["insert"].payload.get("attributeIds")),
                        vec!["attribute-b", "attribute-a"]
                    );
                    assert_eq!(
                        document.objects["attribute-a"].owner_id.as_deref(),
                        Some("block:model")
                    );
                }
                for id in ["insert", "end", "attribute-a", "attribute-b"] {
                    if let Some(object) = document.objects.get_mut(id) {
                        object.erased = true;
                    }
                }
                assert!(
                    document.validate().is_ok(),
                    "coherently erased compound graph remains valid"
                );
                assert_eq!(
                    CadDocument::from_kjd_json(&document.to_kjd_json().unwrap()).unwrap(),
                    document
                );
            }
        }
    }

    #[test]
    fn compound_attributes_reject_broken_links_types_spaces_lifecycle_and_sequence_resources() {
        let mutations: Vec<(&str, fn(&mut CadDocument))> = vec![
            ("duplicate attribute", |d| {
                attribute_field(
                    d,
                    "insert",
                    "attributeIds",
                    CadValue::Array(vec!["attribute-a".into(), "attribute-a".into()]),
                )
            }),
            ("non-string attribute", |d| {
                attribute_field(
                    d,
                    "insert",
                    "attributeIds",
                    CadValue::Array(vec![1u64.into()]),
                )
            }),
            ("non-array attributes", |d| {
                attribute_field(d, "insert", "attributeIds", "attribute-a".into())
            }),
            ("missing attribute", |d| {
                attribute_field(
                    d,
                    "insert",
                    "attributeIds",
                    CadValue::Array(vec!["missing".into()]),
                )
            }),
            ("wrong attribute type", |d| {
                d.objects.get_mut("attribute-a").unwrap().object_type = "TEXT".into()
            }),
            ("wrong parent", |d| {
                attribute_field(d, "attribute-a", "parentInsertId", "end".into())
            }),
            ("non-string parent", |d| {
                attribute_field(d, "attribute-a", "parentInsertId", 7u64.into())
            }),
            ("missing reciprocal attribute", |d| {
                attribute_field(
                    d,
                    "insert",
                    "attributeIds",
                    CadValue::Array(vec!["attribute-b".into()]),
                )
            }),
            ("cross-space attribute", |d| {
                d.objects.get_mut("attribute-a").unwrap().owner_id = Some("block:paper".into())
            }),
            ("native parent used as KJD owner", |d| {
                d.objects.get_mut("attribute-a").unwrap().owner_id = Some("insert".into())
            }),
            ("erased attribute mismatch", |d| {
                d.objects.get_mut("attribute-a").unwrap().erased = true
            }),
            ("missing sequence", |d| {
                attribute_field(d, "insert", "sequenceEndId", CadValue::Null)
            }),
            ("missing sequence object", |d| {
                attribute_field(d, "insert", "sequenceEndId", "missing".into())
            }),
            ("wrong sequence reference type", |d| {
                attribute_field(d, "insert", "sequenceEndId", 3u64.into())
            }),
            ("wrong sequence kind", |d| {
                d.objects.get_mut("end").unwrap().kind = "entity".into()
            }),
            ("wrong sequence owner", |d| {
                d.objects.get_mut("end").unwrap().owner_id = Some("block:model".into())
            }),
            ("wrong sequence type", |d| {
                d.objects.get_mut("end").unwrap().object_type = "CUSTOM".into()
            }),
            ("erased sequence mismatch", |d| {
                d.objects.get_mut("end").unwrap().erased = true
            }),
            ("invalid native owner mode", |d| {
                attribute_field(d, "end", "dxfOwnerMode", "other".into())
            }),
            ("missing native owner mode", |d| {
                attribute_field(d, "end", "dxfOwnerMode", CadValue::Null)
            }),
            ("unregistered sequence layer", |d| {
                attribute_field(d, "end", "layerId", "not-a-layer".into())
            }),
            ("non-string sequence layer", |d| {
                attribute_field(d, "end", "layerId", 3u64.into())
            }),
        ];
        for (name, mutate) in mutations {
            let mut document = attached_fixture("insert", true);
            mutate(&mut document);
            assert!(document.validate().is_err(), "{name}");
            // Exercise the external JSON entry point, not just an in-memory helper.
            let json = document.to_value().to_json().unwrap();
            assert!(
                CadDocument::from_kjd_json(&json).is_err(),
                "parser accepted {name}"
            );
        }
    }

    #[test]
    fn compound_invalid_transaction_preserves_history_handles_and_original_graph() {
        let mut document = attached_fixture("space", true);
        let before = document.clone();
        assert!(document
            .transact(
                document.revision,
                "Break compound relationship",
                "2026-09-11T01:00:00Z",
                "test",
                |draft| { draft.set_erased("attribute-a", true) }
            )
            .is_err());
        assert_eq!(document, before);
    }

    #[test]
    fn transaction_commits_once_and_keeps_proxy_payloads() {
        let mut document = CadDocument::from_kjd_json(&fixture()).unwrap();
        let before_opaque = document.opaque_payloads.clone();
        let mut line = CadObject::new("entity:line-1", "entity", "LINE");
        line.owner_id = Some("block:model".to_owned());
        line.payload = CadValue::Object(BTreeMap::from([
            ("contractVersion".to_owned(), 1u64.into()),
            ("layerId".to_owned(), "layer:0".into()),
        ]));
        document
            .transact(0, "Create line", "2026-08-22T01:00:00Z", "sdk", |draft| {
                draft.create_object(line)
            })
            .unwrap();
        assert_eq!(document.revision, 1);
        assert_eq!(document.revisions.len(), 1);
        assert_eq!(document.opaque_payloads, before_opaque);
        assert_eq!(document.objects["entity:line-1"].handle, "9");
        assert_eq!(
            value_string_array(document.objects["block:model"].payload.get("entityIds")),
            vec!["entity:line-1"]
        );
    }

    #[test]
    fn invalid_transaction_rolls_back_without_consuming_handle() {
        let mut document = CadDocument::from_kjd_json(&fixture()).unwrap();
        let before = document.clone();
        let mut line = CadObject::new("entity:bad", "entity", "LINE");
        line.owner_id = Some("missing".to_owned());
        assert!(document
            .transact(0, "Bad", "2026-08-22T01:00:00Z", "sdk", |draft| draft
                .create_object(line))
            .is_err());
        assert_eq!(document, before);
        assert_eq!(document.allocate_handle().unwrap(), "9");
    }

    #[test]
    fn stale_revision_is_rejected_before_work_runs() {
        let mut document = CadDocument::from_kjd_json(&fixture()).unwrap();
        let result = document.transact(7, "Stale", "2026-08-22T01:00:00Z", "sdk", |_| Ok(()));
        assert_eq!(
            result,
            Err(CadModelError::RevisionConflict {
                expected: 7,
                actual: 0
            })
        );
    }

    #[test]
    fn parser_rejects_duplicate_keys_and_non_finite_numbers() {
        assert!(CadValue::parse_json(r#"{"a":1,"a":2}"#).is_err());
        assert!(CadValue::parse_json("1e9999").is_err());
    }
}
