/* Small, dependency-free Web Mercator map; tiles only load in map view. */
globalThis.TrailMap=class {
  constructor(el,onSelect){this.el=el;this.onSelect=onSelect;this.zoom=9;this.center=[41.3,-81.6];this.trails=[];this.active=false;
    new ResizeObserver(()=>{if(this.active)this.draw();}).observe(el);
    el.addEventListener('pointerdown',e=>{if(e.target.closest('button,a'))return;this.start=[e.clientX,e.clientY,...this.project(...this.center)];el.setPointerCapture(e.pointerId);});
    el.addEventListener('pointermove',e=>{if(!this.start)return;const [x,y,cx,cy]=this.start;this.center=this.unproject(cx-(e.clientX-x),cy-(e.clientY-y));this.draw();});
    for(const evt of ['pointerup','pointercancel'])el.addEventListener(evt,()=>this.start=null);
    el.addEventListener('wheel',e=>{e.preventDefault();this.changeZoom(e.deltaY<0?1:-1);},{passive:false});
  }
  project(lat,lon,z=this.zoom){const n=256*2**z,s=Math.sin(Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180);return [(lon+180)/360*n,(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n];}
  unproject(x,y,z=this.zoom){const n=256*2**z;return [Math.max(-85.0511,Math.min(85.0511,Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI)),((x/n*360-180+180)%360+360)%360-180];}
  changeZoom(delta){this.zoom=Math.max(2,Math.min(18,this.zoom+delta));this.draw();}
  setTrails(trails){this.trails=trails.filter(t=>t.lat!==null);this.fit();}
  fit(){if(!this.trails.length){this.center=[41.3,-81.6];this.zoom=8;this.draw();return;}const lat=this.trails.map(t=>t.lat),lon=this.trails.map(t=>t.lon);this.center=[(Math.min(...lat)+Math.max(...lat))/2,(Math.min(...lon)+Math.max(...lon))/2];this.zoom=14;while(this.zoom>2){const p=this.trails.map(t=>this.project(t.lat,t.lon)),x=p.map(v=>v[0]),y=p.map(v=>v[1]);if(Math.max(...x)-Math.min(...x)<this.el.clientWidth-100&&Math.max(...y)-Math.min(...y)<this.el.clientHeight-100)break;this.zoom--;}this.draw();}
  draw(){if(!this.active)return;const w=this.el.clientWidth,h=this.el.clientHeight;if(!w||!h)return;const [cx,cy]=this.project(...this.center),left=cx-w/2,top=cy-h/2,n=2**this.zoom,tiles=this.el.querySelector('#tiles'),needed=new Set();
    for(let x=Math.floor(left/256);x<=Math.floor((left+w)/256);x++)for(let y=Math.floor(top/256);y<=Math.floor((top+h)/256);y++){if(y<0||y>=n)continue;const id=`${this.zoom}-${x}-${y}`;needed.add(id);let im=tiles.querySelector(`[data-tile="${id}"]`);if(!im){im=new Image();im.alt='';im.draggable=false;im.dataset.tile=id;im.src=`https://tile.openstreetmap.org/${this.zoom}/${((x%n)+n)%n}/${y}.png`;im.onerror=()=>{document.getElementById('mapNote').textContent='Map tiles unavailable. Pins still show; check your internet connection.';};tiles.append(im);}im.style.left=(x*256-left)+'px';im.style.top=(y*256-top)+'px';}
    for(const im of [...tiles.children])if(!needed.has(im.dataset.tile))im.remove();
    const pins=this.el.querySelector('#pins');pins.replaceChildren();for(const t of this.trails){const [x,y]=this.project(t.lat,t.lon);if(x-left<-50||x-left>w+50||y-top<-50||y-top>h+50)continue;const b=document.createElement('button');b.textContent=t.rating.toFixed(1);b.title=t.name;b.setAttribute('aria-label',`${t.name}, ${t.rating} out of 5. Show review`);b.style.left=(x-left)+'px';b.style.top=(y-top)+'px';b.onclick=()=>this.onSelect(t);pins.append(b);}
  }
};
