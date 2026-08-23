/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Orin AI. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';

import { OrinMark } from './OrinMark.js';

// Time-of-day greeting, same idea as Claude's "Good evening" header.
// No user-name state exists in Orin today - wire `name` up to a real
// settings/profile value later; falls back to a plain greeting.
// Re-evaluated every minute so a long-lived sidebar follows the device clock.
const useGreeting = (name?: string) => {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(timer);
	}, []);
	const hour = now.getHours();
	const label = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
	return { text: `Good ${label}${name ? `, ${name}` : ''}` };
};

const FeatureBadge = ({ label }: { label: string }) => (
	<span className="
		inline-flex items-center gap-1
		px-2.5 py-0.5 rounded-full
		text-[10px] font-medium uppercase tracking-wider
		bg-orin-accent/10 text-orin-accent
		border border-orin-accent/20
		select-none
	">{label}</span>
);

export const OrinHome = ({
	name,
	children, // the input bar (OrinChatArea + textarea) gets passed in so OrinHome
	// stays purely presentational and doesn't duplicate SidebarChat's input logic
}: {
	name?: string;
	children: React.ReactNode;
}) => {
	const { text } = useGreeting(name);

	return (
		<div className={`w-full flex flex-col items-center gap-5 pt-12 px-2`}>
			{/* Hero section with animated bolt */}
			<div className={`
				flex flex-col items-center gap-3
				text-orin-fg-2 text-center
				select-none
			`}>
				<div className="relative">
					<OrinMark size={44} />
					{/* Ambient glow behind the mark */}
					<div className="absolute inset-0 rounded-full blur-xl opacity-20"
						style={{ background: 'radial-gradient(circle, #e08a3c 0%, transparent 70%)' }}
					/>
				</div>
				<span className="text-lg font-semibold text-orin-fg-1 tracking-tight">{text}</span>
				<span className="text-xs text-orin-fg-3 max-w-[260px] leading-relaxed">
					Your free AI code editor. Build, refactor, and deploy — powered by any model.
				</span>
			</div>

			{/* Feature badges */}
			<div className="flex flex-wrap justify-center gap-1.5">
				<FeatureBadge label="100% Free" />
				<FeatureBadge label="Multi-Agent" />
				<FeatureBadge label="Any Model" />
			</div>

			{/* Input area */}
			<div className="w-full max-w-md">
				{children}
			</div>
		</div>
	);
};
