// Same local SVG paths and stroke treatment as LoRA Studio's manager.
const paths = {
 keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
 folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>', paste:'<path d="M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12h8M8 16h6"/>', down:'<path d="m6 9 6 6 6-6"/>', right:'<path d="m9 6 6 6-6 6"/>', check:'<path d="m5 12 4 4L19 6"/>', power:'<path d="M12 2v10M5.6 5.6a9 9 0 1 0 12.8 0"/>',
 plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
 copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 7"/>',
 box:'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 2v4M16 2v4M8 18v4M16 18v4M2 8h4M18 8h4M2 16h4M18 16h4"/>',
 cursor:'<path d="m4 3 7 18 2-8 8-2L4 3Z"/>',
 undo:'<path d="M3 7h11a6 6 0 0 1 0 12M3 7l5-5M3 7l5 5"/>',
 redo:'<path d="M21 7H10a6 6 0 0 0 0 12m11-12-5-5m5 5-5 5"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
 minus:'<path d="M5 12h14"/>', fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 person:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 text:'<path d="M4 6V3h16v3M12 3v18M8 21h8"/>', object:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/>',
};
export const icon=(name,size=16)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.box}</svg>`;
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
