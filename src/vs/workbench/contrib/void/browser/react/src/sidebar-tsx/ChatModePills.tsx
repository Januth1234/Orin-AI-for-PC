/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Orin AI. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAccessor, useSettingsState } from '../util/services.js';
import { ChatMode } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';

// Same three underlying modes Void already ships (normal / gather / agent) -
// 'normal' is relabeled 'Chat' and shown as the two primary pills, matching
// Claude's Chat/Cowork toggle. 'Gather' stays reachable via the small caret
// so power users don't lose the read-only research mode.
const primaryModes: { mode: ChatMode; label: string }[] = [
	{ mode: 'normal', label: 'Chat' },
	{ mode: 'agent', label: 'Agent' },
];

const overflowMode: { mode: ChatMode; label: string; detail: string } = {
	mode: 'gather',
	label: 'Gather',
	detail: 'Reads files, but can\'t edit',
};

export const ChatModePills = ({ className = '' }: { className?: string }) => {
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');
	const settingsState = useSettingsState();
	const currentMode = settingsState.globalSettings.chatMode;

	const [overflowOpen, setOverflowOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);

	const setMode = useCallback((mode: ChatMode) => {
		voidSettingsService.setGlobalSetting('chatMode', mode);
		setOverflowOpen(false);
	}, [voidSettingsService]);

	const isOverflowActive = currentMode === overflowMode.mode;

	return (
		<div ref={wrapperRef} className={`relative flex items-center gap-1 ${className}`}>
			<div className="flex items-center gap-0.5 bg-void-bg-2 rounded-full p-0.5">
				{primaryModes.map(({ mode, label }) => {
					const isActive = currentMode === mode;
					return (
						<button
							key={mode}
							type="button"
							onClick={() => setMode(mode)}
							className={`
								text-xs font-medium rounded-full px-3 py-1
								transition-colors
								${isActive
									? 'bg-void-bg-1 text-void-fg-1'
									: 'text-void-fg-3 hover:text-void-fg-1'}
							`}
						>
							{label}
						</button>
					);
				})}

				{/* Gather - collapsed into a caret so the pill row stays two-wide like Chat/Agent */}
				<button
					type="button"
					aria-label="More chat modes"
					onClick={() => setOverflowOpen(v => !v)}
					className={`
						flex items-center rounded-full px-1 py-1
						${isOverflowActive ? 'bg-void-bg-1 text-void-fg-1' : 'text-void-fg-3 hover:text-void-fg-1'}
					`}
				>
					<ChevronDown size={12} />
				</button>
			</div>

			{overflowOpen && (
				<div className={`
					absolute bottom-full left-0 mb-1 z-10
					bg-void-bg-1 border border-void-border-2 rounded-md
					shadow-sm p-1 min-w-[160px]
				`}>
					<button
						type="button"
						onClick={() => setMode(overflowMode.mode)}
						className={`
							w-full text-left text-xs rounded px-2 py-1.5
							${isOverflowActive ? 'bg-void-bg-2 text-void-fg-1' : 'text-void-fg-2 hover:bg-void-bg-2'}
						`}
					>
						<div className="font-medium">{overflowMode.label}</div>
						<div className="text-void-fg-3 text-[11px]">{overflowMode.detail}</div>
					</button>
				</div>
			)}
		</div>
	);
};
