// Normally you'd want to put these exports in the files that register them, but if you do that you'll get an import order error if you import them in certain cases.
// (importing them runs the whole file to get the ID, causing an import error). I guess it's best practice to separate out IDs, pretty annoying...

export const ORIN_CTRL_L_ACTION_ID = 'orin.ctrlLAction'

export const ORIN_CTRL_K_ACTION_ID = 'orin.ctrlKAction'

export const ORIN_ACCEPT_DIFF_ACTION_ID = 'orin.acceptDiff'

export const ORIN_REJECT_DIFF_ACTION_ID = 'orin.rejectDiff'

export const ORIN_GOTO_NEXT_DIFF_ACTION_ID = 'orin.goToNextDiff'

export const ORIN_GOTO_PREV_DIFF_ACTION_ID = 'orin.goToPrevDiff'

export const ORIN_GOTO_NEXT_URI_ACTION_ID = 'orin.goToNextUri'

export const ORIN_GOTO_PREV_URI_ACTION_ID = 'orin.goToPrevUri'

export const ORIN_ACCEPT_FILE_ACTION_ID = 'orin.acceptFile'

export const ORIN_REJECT_FILE_ACTION_ID = 'orin.rejectFile'

export const ORIN_ACCEPT_ALL_DIFFS_ACTION_ID = 'orin.acceptAllDiffs'

export const ORIN_REJECT_ALL_DIFFS_ACTION_ID = 'orin.rejectAllDiffs'
