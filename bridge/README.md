# Bridge developer notes

For source setup, see the repository's main guide. The local WebSocket server maintains independent game state per connection, translates supported action messages and runs a separately supplied ONNX model. `Cargo.toml` uses the adjacent `Mortal/libriichi` source; no original machine-specific paths are needed. The `tests` folder includes a historical restoration fixture with its source attribution.

The included `tests/e2e.py` is a macOS portable-package test: it expects that package's model, bundled runtime and bridge layout. Do not treat it as a self-contained source test. The source-only unit tests are documented in the main guide.
