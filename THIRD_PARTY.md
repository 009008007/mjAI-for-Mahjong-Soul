# Third-party materials

- `Mortal/libriichi/` is derived from [Mortal](https://github.com/Equim-chan/Mortal).
  The included version is licensed AGPL-3.0-or-later; its license text is
  in [Mortal/LICENSE](Mortal/LICENSE). This copy contains local modifications.
- `bridge/tests/fixtures/sync_response.bin` contains an adapted historical test
  fixture derived from [Akagi v3](https://github.com/shinkuan/Akagi/blob/v3/src/bridge/majsoul/mod.rs).
  Akagi v3 copyright 2026 Shinkuan. The fixture is distributed under the
  [Apache License 2.0](third_party/Apache-2.0.txt); see the
  [upstream notice](https://github.com/shinkuan/Akagi/blob/v3/NOTICE).
- Rust crates named in `bridge/Cargo.lock` have their own licenses.
- ONNX Runtime and the model are not included in this source distribution. A
  binary release bundling any third-party runtime must retain its notices.

The supplied ONNX model's origin and redistribution terms have not been
established. It is deliberately excluded; only distribute model weights after
their provenance and permission have been confirmed.
