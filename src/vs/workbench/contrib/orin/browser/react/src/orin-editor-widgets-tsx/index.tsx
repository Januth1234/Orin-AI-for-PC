/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { OrinCommandBarMain } from './OrinCommandBar.js'
import { OrinSelectionHelperMain } from './OrinSelectionHelper.js'

export const mountOrinCommandBar = mountFnGenerator(OrinCommandBarMain)

export const mountOrinSelectionHelper = mountFnGenerator(OrinSelectionHelperMain)

