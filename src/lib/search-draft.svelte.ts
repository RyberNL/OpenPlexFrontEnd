/**
 * What was typed into a SearchBar, for the search page it opens: keystrokes made while the page
 * loads land in the bar, and the page picks them up (and the focus) from here.
 */
export const searchDraft = $state({ text: '', pending: false });
