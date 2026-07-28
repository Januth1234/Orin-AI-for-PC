import { URI } from '../../../../base/common/uri.js';

export type OrinDirectoryItem = {
	uri: URI;
	name: string;
	isSymbolicLink: boolean;
	children: OrinDirectoryItem[] | null;
	isDirectory: boolean;
	isGitIgnoredDirectory: false | { numChildren: number }; // if directory is gitignored, we ignore children
}
