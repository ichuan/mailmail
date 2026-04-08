const fs = require('fs');

function htmlToJsx(html) {
    let jsx = html
        // replace class with className
        .replace(/class="/g, 'className="')
        // replace svg attributes 
        .replace(/stroke-width="/g, 'strokeWidth="')
        .replace(/stroke-linecap="/g, 'strokeLinecap="')
        .replace(/stroke-linejoin="/g, 'strokeLinejoin="')
        .replace(/clip-rule="/g, 'clipRule="')
        .replace(/fill-rule="/g, 'fillRule="')
        .replace(/for="/g, 'htmlFor="')
        .replace(/tabindex="/g, 'tabIndex="')
        // replace inline styles
        .replace(/style="([^"]*)"/g, (match, p1) => {
             if (!p1) return '';
             let styleObj = {};
             p1.split(';').forEach(style => {
                 let parts = style.split(':');
                 if(parts.length >= 2) {
                     let key = parts[0].trim().replace(/-([a-z])/g, g => g[1].toUpperCase());
                     let val = parts.slice(1).join(':').trim();
                     styleObj[key] = val;
                 }
             });
             return "style={" + JSON.stringify(styleObj) + "}";
        })
        // fix unclosed inputs and imgs
        .replace(/<input([^>]*[^\/])>/gi, '<input$1 />')
        .replace(/<img([^>]*[^\/])>/gi, '<img$1 />')
        .replace(/<hr([^>]*[^\/])>/gi, '<hr$1 />')
        .replace(/<br([^>]*[^\/])>/gi, '<br$1 />')
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

export default function ${name}View() {
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
        console.log(`Missing ${name}`);
        console.error(err);
    }
});
