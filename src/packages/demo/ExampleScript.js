/**
 * # ExampleScript
 *
 * Demonstrates [[CodeRendererPlugin]]: the leading JSDoc-style block
 * renders as markdown, while everything after it renders inside a fenced
 * JavaScript code block.
 *
 * - extract JSDoc frontmatter
 * - render the comment body as markdown
 * - wrap the rest of the source in a fence
 *
 * Edit this tiddler and remove the comment to see the no-frontmatter path
 * (the whole body renders as a single code block).
 */
function greet(name) {
  return `Hello, ${name}!`;
}
