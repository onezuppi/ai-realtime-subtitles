/** getElementById with the element type given by the caller. The ids come from the page's own HTML. */
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
