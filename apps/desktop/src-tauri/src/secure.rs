//! Secrets (the session refresh token) in the macOS Keychain, scoped to the
//! app's bundle identifier.

#[cfg(target_os = "macos")]
mod imp {
    use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

    // errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn get(service: &str, key: &str) -> Result<Option<String>, String> {
        match get_generic_password(service, key) {
            Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|e| e.to_string()),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(service: &str, key: &str, value: &str) -> Result<(), String> {
        set_generic_password(service, key, value.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn delete(service: &str, key: &str) -> Result<(), String> {
        match delete_generic_password(service, key) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn get(_service: &str, _key: &str) -> Result<Option<String>, String> {
        Err("secure storage is only implemented on macOS".into())
    }
    pub fn set(_service: &str, _key: &str, _value: &str) -> Result<(), String> {
        Err("secure storage is only implemented on macOS".into())
    }
    pub fn delete(_service: &str, _key: &str) -> Result<(), String> {
        Err("secure storage is only implemented on macOS".into())
    }
}

pub use imp::*;

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn keychain_round_trip() {
        let service = "app.studykingdom.desktop.test";
        let key = "unit-test-token";
        delete(service, key).unwrap();
        assert_eq!(get(service, key).unwrap(), None);
        set(service, key, "secret-value").unwrap();
        assert_eq!(get(service, key).unwrap().as_deref(), Some("secret-value"));
        set(service, key, "rotated").unwrap();
        assert_eq!(get(service, key).unwrap().as_deref(), Some("rotated"));
        delete(service, key).unwrap();
        assert_eq!(get(service, key).unwrap(), None);
    }
}
