export const ICON_PATHS = {
	home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
	search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
	movie: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
	show: 'M3 7h18v12H3zM8 3l4 4 4-4',
	libraries: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 5l3.5.9-3.6 14.2-3.5-.9z',
	live: 'M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01M3 21h18',
	user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
	shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
	logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
	back: 'M15 18l-6-6 6-6',
	play: 'M7 4v16l13-8z',
	check: 'M5 12l5 5L20 7',
	close: 'M6 6l12 12M18 6 6 18'
} as const;

export type IconName = keyof typeof ICON_PATHS;
