//! macOS integrations: frontmost application, screen lock, input idle time and
//! a power assertion that keeps the Mac awake during paper-mode sessions.
//!
//! None of this can tell which website a browser shows, and none of it records
//! the screen, camera or keystrokes.

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use objc2_app_kit::{NSApplicationActivationPolicy, NSWorkspace};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            level: u32,
            name: CFStringRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;
    const ASSERTION_LEVEL_ON: u32 = 255;

    pub fn frontmost_app() -> Option<(String, String)> {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        let bundle = app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
        let name = app.localizedName().map(|s| s.to_string()).unwrap_or_else(|| bundle.clone());
        Some((bundle, name))
    }

    pub fn running_apps() -> Vec<(String, String)> {
        let workspace = NSWorkspace::sharedWorkspace();
        let apps = workspace.runningApplications();
        let mut out: Vec<(String, String)> = apps
            .iter()
            .filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular)
            .filter_map(|a| {
                let id = a.bundleIdentifier()?.to_string();
                let name = a.localizedName().map(|s| s.to_string()).unwrap_or_else(|| id.clone());
                Some((id, name))
            })
            .collect();
        out.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));
        out.dedup_by(|a, b| a.0 == b.0);
        out
    }

    pub fn screen_locked() -> bool {
        // SAFETY: returns a +1 retained dictionary or null.
        let raw = unsafe { CGSessionCopyCurrentDictionary() };
        if raw.is_null() {
            return false;
        }
        let dict: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_create_rule(raw) };
        let key = CFString::from_static_string("CGSSessionScreenIsLocked");
        dict.find(&key)
            .and_then(|v| v.downcast::<CFBoolean>())
            .map(bool::from)
            .unwrap_or(false)
    }

    pub fn idle_seconds() -> f64 {
        // SAFETY: plain C call with constant arguments.
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) }
    }

    /// Releases the assertion when dropped.
    pub struct Assertion(u32);

    impl Assertion {
        pub fn prevent_idle_sleep(reason: &str) -> Result<Self, String> {
            let kind = CFString::from_static_string("PreventUserIdleSystemSleep");
            let name = CFString::new(reason);
            let mut id: u32 = 0;
            // SAFETY: both CFStrings outlive the call; id is a valid out-pointer.
            let rc = unsafe {
                IOPMAssertionCreateWithName(kind.as_concrete_TypeRef(), ASSERTION_LEVEL_ON, name.as_concrete_TypeRef(), &mut id)
            };
            if rc == 0 {
                Ok(Assertion(id))
            } else {
                Err(format!("IOPMAssertionCreateWithName failed: {rc}"))
            }
        }
    }

    impl Drop for Assertion {
        fn drop(&mut self) {
            // SAFETY: id came from a successful IOPMAssertionCreateWithName.
            unsafe {
                IOPMAssertionRelease(self.0);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn frontmost_app() -> Option<(String, String)> {
        None
    }
    pub fn running_apps() -> Vec<(String, String)> {
        Vec::new()
    }
    pub fn screen_locked() -> bool {
        false
    }
    pub fn idle_seconds() -> f64 {
        0.0
    }
    pub struct Assertion;
    impl Assertion {
        pub fn prevent_idle_sleep(_reason: &str) -> Result<Self, String> {
            Ok(Assertion)
        }
    }
}

pub use imp::*;

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn reads_frontmost_and_running_apps() {
        // A login session always has regular GUI apps (at least Finder).
        let apps = running_apps();
        assert!(!apps.is_empty(), "expected running GUI applications");
        assert!(apps.iter().all(|(id, name)| !id.is_empty() && !name.is_empty()));
        if let Some((id, _)) = frontmost_app() {
            assert!(!id.is_empty());
        }
    }

    #[test]
    fn reports_lock_and_idle_state() {
        let idle = idle_seconds();
        assert!(idle >= 0.0 && idle.is_finite());
        let _ = screen_locked();
    }

    #[test]
    fn holds_and_releases_a_power_assertion() {
        let a = Assertion::prevent_idle_sleep("Study Kingdom test").expect("assertion");
        drop(a);
    }
}
