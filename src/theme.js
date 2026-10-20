// Theme preference: light, dark, or follow the system. Everything here is pure
// except readThemeColors, so the rules can be tested without a browser.

export const THEME_KEY = 'gol-theme';
export const PREFERENCES = ['system', 'light', 'dark'];

const THEME_VARS = {
  background: '--board-background',
  board: '--board',
  cell: '--cell',
  gridMinor: '--grid-minor',
  gridMajor: '--grid-major',
  hover: '--hover',
  ghost: '--ghost',
  cursor: '--cursor',
  cursorHalo: '--cursor-halo',
};

export function normalizePreference(value) {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference, systemDark) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark ? 'dark' : 'light';
}

export function loadPreference(storage) {
  try {
    return normalizePreference(storage?.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

// "System" is stored as the absence of a value. Returns false when storage is
// missing, blocked or full, so the caller can carry on for this session only.
export function savePreference(storage, preference) {
  try {
    if (!storage) return false;
    if (normalizePreference(preference) === 'system') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

// Reads the canvas palette from CSS custom properties.
export function readThemeColors(element = document.documentElement) {
  const style = getComputedStyle(element);
  const colors = {};
  for (const [key, name] of Object.entries(THEME_VARS)) {
    const value = style.getPropertyValue(name).trim();
    if (value) colors[key] = value;
  }
  return colors;
}

// Keeps `root.dataset.theme` in step with the stored preference and, while the
// preference is "system", with the OS setting. An explicit choice is never
// overridden by later OS changes. `onChange(theme, preference)` runs after the
// attribute is updated, so computed styles already reflect the new theme.
export function createThemeController({ root, storage, mediaQuery, onChange }) {
  let preference = loadPreference(storage);
  let persisted = true;
  let applied = null;

  function apply() {
    const theme = resolveTheme(preference, mediaQuery.matches);
    root.dataset.themePreference = preference;
    if (theme !== applied) {
      applied = theme;
      root.dataset.theme = theme;
      onChange?.(theme, preference);
    }
    return theme;
  }

  const onSystemChange = () => {
    if (preference === 'system') apply();
  };
  if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onSystemChange);
  else mediaQuery.addListener?.(onSystemChange);

  apply();

  return {
    get preference() {
      return preference;
    },
    get theme() {
      return applied;
    },
    // False once a save has failed: the choice still applies, but only until reload.
    get persisted() {
      return persisted;
    },
    setPreference(next) {
      preference = normalizePreference(next);
      persisted = savePreference(storage, preference);
      return apply();
    },
  };
}
