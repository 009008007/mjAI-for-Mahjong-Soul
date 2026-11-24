/// Minimal per-connection state for safe MJAI conversion.
/// The local seat must be supplied explicitly; this bridge does not decode auth.
#[derive(Debug)]
pub struct BridgeState {
    pub(crate) seat: u8,
    pub(crate) active: bool,
    pub(crate) announced: bool,
    pub(crate) last_step: Option<u32>,
    pub(crate) doras: Vec<String>,
    pub(crate) pons: Vec<(u8, Vec<String>)>,
}

impl BridgeState {
    pub fn new(seat: u8) -> Result<Self, String> {
        if seat > 3 {
            return Err("seat must be an absolute MJAI seat in 0..=3".into());
        }
        Ok(Self {
            seat,
            active: false,
            announced: false,
            last_step: None,
            doras: Vec::new(),
            pons: Vec::new(),
        })
    }

    /// Stop emitting incremental events after a malformed/missing action.
    /// An independently valid ActionNewRound can re-establish the state.
    pub fn desynchronize(&mut self) {
        self.active = false;
        // A previously queued start_game may have been lost. Reannounce the
        // seat on the next usable round so downstream state can restart.
        self.announced = false;
        self.last_step = None;
        self.doras.clear();
        self.pons.clear();
    }
}
