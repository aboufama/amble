import { describe, expect, it } from 'vitest';
import { closeSvg, svgSoFar } from '../src/compiler/sketch';

describe('drawings in progress', () => {
  it('reads the nth svg string of a reply as it streams, escapes and all', () => {
    const reply = JSON.stringify({ costumes: [{ name: 'a', svg: '<svg a="1">\n<g>' }, { name: 'b', svg: '<svg b="2"><text>é</text></svg>' }] });
    expect(svgSoFar(reply, 0)).toEqual({ svg: '<svg a="1">\n<g>', done: true });
    expect(svgSoFar(reply, 1)).toEqual({ svg: '<svg b="2"><text>é</text></svg>', done: true });
    expect(svgSoFar(reply, 2)).toBeNull();
    const cut = reply.slice(0, reply.indexOf('\\n') + 1); // ends on a lone backslash
    expect(svgSoFar(cut, 0)).toEqual({ svg: '<svg a="1">', done: false });
    expect(svgSoFar('{"svg":"<svg>\\u00', 0)).toEqual({ svg: '<svg>', done: false });
  });

  it('closes an SVG cut off part way, up to its last whole tag', () => {
    expect(closeSvg('<sv')).toBeNull();
    expect(closeSvg('<svg viewBox="0 0 10 10"><g fill="red"><circle r="2"/><rect x="1" wid')).toBe('<svg viewBox="0 0 10 10"><g fill="red"><circle r="2"/></g></svg>');
    expect(closeSvg('<svg><defs><linearGradient id="a"><stop offset="0"/></linearGradient></defs><path d="M0 0"></path><text x="1">Hel')).toBe('<svg><defs><linearGradient id="a"><stop offset="0"/></linearGradient></defs><path d="M0 0"></path><text x="1"></text></svg>');
    expect(closeSvg('<svg><style>.a{fill:red} .b{fi')).toBe('<svg></svg>');
    expect(closeSvg('<svg><g a=">"><rect/></g></svg>')).toBe('<svg><g a=">"><rect/></g></svg>');
    expect(closeSvg('<?xml version="1.0"?><svg><rect/>')).toBe('<svg><rect/></svg>');
  });
});
