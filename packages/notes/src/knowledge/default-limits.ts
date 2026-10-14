// No imports, on purpose: the contract defaults its search and related rows to these, and it must
// not load the engines (and the stemmer behind them) to do it.

export const SEARCH_DEFAULT_LIMIT = 20;

export const RELATED_DEFAULT_LIMIT = 8;
