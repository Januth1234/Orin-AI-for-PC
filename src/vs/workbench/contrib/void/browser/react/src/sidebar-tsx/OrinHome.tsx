/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Orin AI. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { OrinMark } from './OrinMark.js';

// Time-of-day greeting, same idea as Claude's "Good evening" header.
// No user-name state exists in Void today - wire `name` up to a real
// settings/profile value later; falls back to a plain greeting.
const useGreeting = (name?: string) => {
	const hour = new Date().getHours();
	const label = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
	return { text: `Good ${label}${name ? `, ${name}` : ''}` };
};

export const OrinHome = ({
	name,
	children, // the input bar (VoidChatArea + textarea) gets passed in so OrinHome
	// stays purely presentational and doesn't duplicate SidebarChat's input logic
}: {
	name?: string;
	children: React.ReactNode;
}) => {
	const { text } = useGreeting(name);

	return (
		<div className={`w-full flex flex-col items-center gap-3 pt-10 px-2`}>
			<div className={`
				flex flex-col items-center gap-2
				text-void-fg-2 text-center
				select-none
			`}>
				<OrinMark size={28} />
				<span className="text-base font-medium text-void-fg-1">{text}</span>
				<span className="text-xs text-void-fg-3">What can we build together?</span>
			</div>

			<div className="w-full max-w-md">
				{children}
			</div>
		</div>
	);
};
