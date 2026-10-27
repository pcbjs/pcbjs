/** The folder holding one folder per skill. */
export declare const skillsDir: string
/** The skill names, sorted. */
export declare function skillNames(): string[]
/** The `description` of a skill's frontmatter. */
export declare function describe(name: string): string
/** Copies every skill into `to`, replacing a folder of the same name. */
export declare function install(to: string): { name: string; dest: string; updated: boolean }[]
