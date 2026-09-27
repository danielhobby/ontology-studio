# Ontology Studio

A desktop Electron app for turning an ontology into friendly forms for instance creation.

## Run it

```powershell
npm.cmd install
npm.cmd start
```

## What it does

1. Imports `.ttl`, `.turtle`, `.jsonld`, or `.json` ontologies.
2. Finds classes and declared RDF/OWL properties, including labels, comments, domains, ranges, and inheritance.
3. Lets you choose a class and create an instance with an automatically scoped form.
4. Lets you select an instance in the sidebar and edit it in the same form.
5. Imports an existing JSON-LD instance dataset into the active ontology workspace for editing.
6. Loads a standalone Turtle or JSON-LD SHACL file, then runs validation and shows a readable conformance report.
7. Exports created instances as a JSON-LD document with the ontology's prefix context.

Turtle parsing is provided by the `n3` package. JSON-LD import supports the common graph-based shape (`@graph`) with embedded RDF/OWL and SHACL vocabulary terms. SHACL validation supports `sh:NodeShape`, `sh:targetClass`, `sh:property`, `sh:path`, `sh:minCount`, `sh:maxCount`, `sh:class`, `sh:datatype`, and `sh:nodeKind` constraints. `sh:minCount` constraints are marked as required fields in the editor, and supported constraints are checked inline before an instance can be saved.


## License

This project is available under the [MIT License](LICENSE).