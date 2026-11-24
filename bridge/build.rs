fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=proto/gameplay.proto");
    // A vendored compiler makes this build independent of a system protoc.
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path()?);
    let mut config = prost_build::Config::new();
    // Decode with a Bytes input so these nested byte fields can share storage.
    config.bytes([".lq.Wrapper.data", ".lq.ActionPrototype.data"]);
    config.compile_protos(&["proto/gameplay.proto"], &["proto"])?;
    Ok(())
}
