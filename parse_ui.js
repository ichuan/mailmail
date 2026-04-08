const fs = require('fs');

function htmlToJsx(html) {
    let jsx = html
        // replace class with className
        .replace(/class="/g, 'className="')
        // replace stroke attributes
        .replace(/stroke-width="/g, 'strokeWidth="')
        .replace(/stroke-linecap="/g, 'strokeLinecap="')
        .replace(/stroke-linejoin="/g, 'strokeLinejoin="')
        .replace(/clip-rule="/g, 'clipRule="')
        .replace(/fill-rule="/g, 'fillRule="')
        .replace(/d="/g, 'd="') // Keep standard
        // replace inline styles if any (Stitch usually uses Tailwind, but just in case)
        .replace(/style="([^"]*)"/g, (match, p1) => {
             // simplified style conversion
             if (!p1) return '';
             let styleObj = {};
             p1.split(';').forEach(style => {
                 let [key, val] = style.split(':');
                 if(key && val) {
                     key = key.trim().replace(/-([a-z])/g, g => g[1].toUpperCase());
                     styleObj[key] = val.trim();
                 }
             });
             return "style={" + JSON.stringify(styleObj) + "}";
        })
        // fix unclosed inputs and imgs
        .replace(/<input([^>]*[^\/])>/g, '<input$1 />')
        .replace(/<img([^>]*[^\/])>/g, '<img$1 />')
        // fix HTML comments
        .replace(/<!--([\s\S]*?)-->/g, '{/*$1*/}');

    // Extract body content
    const bodyMatch = jsx.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if(bodyMatch && bodyMatch[1]) {
        jsx = bodyMatch[1];
    }
    return jsx;
}

['Inbox', 'Settings', 'AddAccount'].forEach(name => {
    let filePath = `src/ui_exports/${name}.html`;
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let jsx = htmlToJsx(content);
        
        let header = `import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cx(...inputs) {
  return twMerge(clsx(inputs));
}

export default function ${name}() {
  return (
    <>
      ${jsx}
    </>
  );
}
`;
        fs.writeFileSync(`src/${name}View.tsx`, header);
        console.log(`Converted ${name}`);
    } catch(err) {
        console.error(err);
    }
});
