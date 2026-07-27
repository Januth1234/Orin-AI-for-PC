/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Orin AI. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Redrawn from scratch - not a trace of the uploaded PNG. Single continuous
// bolt path, asymmetric notch, no rounded-square lockup so it can sit
// standalone (tab icon, avatar, favicon) or inside a container elsewhere.
// Color intentionally differs from the source mark (amber, not teal) -
// swap `accent` to whatever the final Orin palette lands on.

export const OrinMark = ({
	state = 'idle', // 'idle' | 'thinking' - thinking plays while a response is streaming
	size = 28,
	accent = '#e08a3c',
}: {
	state?: 'idle' | 'thinking';
	size?: number;
	accent?: string;
}) => {
	const isThinking = state === 'thinking';

	return (
		<span
			className="orin-mark-wrap"
			style={{ width: size, height: size, position: 'relative', display: 'inline-block' }}
		>
			<style>{`
				@keyframes orin-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
				@keyframes orin-flicker { 0%, 100% { opacity: 1; } 50% { opacity: 0.72; } }
				@keyframes orin-ring { 0% { transform: scale(0.6); opacity: 0.45; } 100% { transform: scale(1.9); opacity: 0; } }
				@keyframes orin-sweep { 0% { transform: translateX(-60%) rotate(20deg); } 100% { transform: translateX(160%) rotate(20deg); } }
			`}</style>

			{isThinking && [0, 1, 2].map(i => (
				<span
					key={i}
					style={{
						position: 'absolute', inset: 0, borderRadius: '50%',
						border: `1px solid ${accent}`, opacity: 0,
						animation: 'orin-ring 1.8s ease-out infinite',
						animationDelay: `${i * 0.6}s`,
					}}
				/>
			))}

			<svg
				viewBox="0 0 24 24" width={size} height={size}
				style={{ position: 'relative', zIndex: 1 }}
				role="img" aria-label="Orin"
			>
				<path
					d="M13.6 3 L7.2 12.8 L11.4 12.8 L9.8 21 L17.4 10.4 L12.6 10.4 Z"
					fill={accent}
					style={{
						transformOrigin: 'center',
						animation: isThinking
							? 'orin-flicker 1.4s ease-in-out infinite'
							: 'orin-breathe 3.2s ease-in-out infinite',
					}}
				/>
			</svg>
		</span>
	);
};
