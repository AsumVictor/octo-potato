'use strict';

beforeAll(() => {
  require('../modules/data/NodeParser.js');
});

function xml(str) {
  return new DOMParser().parseFromString(str, 'text/xml');
}

const FULL_XML = xml(`<?xml version="1.0"?>
<tour>
  <panorama id="node1">
    <userdata title="Main Hall" latitude="5.749" longitude="-0.219" tags="Location"/>
    <view><start pan="90" tilt="-5" fov="80"/></view>
    <hotspot id="hs1" url="{node2}" pan="45" tilt="0" title="To Library" distance="30"/>
    <hotspot id="hs2" url="{node3}" pan="120" tilt="0" title="To Road" distance="20"/>
  </panorama>
  <panorama id="node2">
    <userdata title="Library" latitude="5.750" longitude="-0.220" tags="ROAD|Location"/>
    <hotspot id="hs3" url="{node1}" pan="225" tilt="0" title="Back" distance="30"/>
  </panorama>
  <panorama id="node3">
    <userdata title="Road Node" latitude="5.748" longitude="-0.218" tags="ROAD"/>
  </panorama>
  <panorama id="nodata">
  </panorama>
</tour>`);

describe('NodeParser — parse()', () => {
  let nodes;
  beforeAll(() => { nodes = Nav.NodeParser.parse(FULL_XML); });

  test('creates a node for each panorama with userdata', () => {
    expect(nodes).toHaveProperty('node1');
    expect(nodes).toHaveProperty('node2');
    expect(nodes).toHaveProperty('node3');
  });

  test('skips panoramas with no userdata element', () => {
    expect(nodes).not.toHaveProperty('nodata');
  });

  test('extracts title from userdata', () => {
    expect(nodes['node1'].title).toBe('Main Hall');
    expect(nodes['node2'].title).toBe('Library');
  });

  test('parses lat and lng as numbers', () => {
    expect(nodes['node1'].lat).toBeCloseTo(5.749);
    expect(nodes['node1'].lng).toBeCloseTo(-0.219);
  });

  test('reads start pan/tilt/fov from view element', () => {
    expect(nodes['node1'].startPan).toBe(90);
    expect(nodes['node1'].startTilt).toBe(-5);
    expect(nodes['node1'].startFov).toBe(80);
  });

  test('defaults startFov to 100 when view element is absent', () => {
    expect(nodes['node3'].startFov).toBe(100);
  });

  test('sets isRoad true only when ROAD tag is present', () => {
    expect(nodes['node1'].isRoad).toBe(false);
    expect(nodes['node2'].isRoad).toBe(true);
    expect(nodes['node3'].isRoad).toBe(true);
  });

  test('sets isLocation from Location tag', () => {
    expect(nodes['node1'].isLocation).toBe(true);
    expect(nodes['node3'].isLocation).toBe(false);
  });

  test('parses hotspots array', () => {
    expect(nodes['node1'].hotspots).toHaveLength(2);
  });

  test('strips curly braces from hotspot targetId', () => {
    expect(nodes['node1'].hotspots[0].targetId).toBe('node2');
  });

  test('reads hotspot pan, tilt, distance', () => {
    const hs = nodes['node1'].hotspots[0];
    expect(hs.pan).toBe(45);
    expect(hs.tilt).toBe(0);
    expect(hs.distance).toBe(30);
  });

  test('node with no hotspots has empty array', () => {
    expect(nodes['node3'].hotspots).toHaveLength(0);
  });

  test('tags array is populated correctly', () => {
    expect(nodes['node2'].tags).toContain('ROAD');
    expect(nodes['node2'].tags).toContain('Location');
  });
});
