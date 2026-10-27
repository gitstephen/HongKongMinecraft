import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';

/**************************************************
 * Config
 **************************************************/

const CELL_SIZE = 350; 

const LAND_HEIGHT = 2;
const COAST_HEIGHT = 1; 
const COAST_WIDTH = 1;
const SHALLOW_HEIGHT = 0.5;

/* Color */

const COLORS = {
    LAND: 0x55aa55,  // Minecraft 草地
	LAND_TOP:0x74b85b,
    LAND_SIDE:0x8b5a2b,	
    DIRT: 0x8b5a2b,
    COAST: 0xe6cf7a,
    SHALLOW: 0x4fc3f7,
    OCEAN: 0x1565c0,
    SKY: 0xb3e5fc
};

const MATERIALS = {
    LAND_OPACITY: 1.0,
    SHALLOW_OPACITY: 0.75,
    OCEAN_OPACITY: 0.85
};

const GEOJSON_URL = "/hk_coast.json";


/**************************************************
 * Scene
 **************************************************/

const scene = new THREE.Scene();

scene.background = new THREE.Color(COLORS.OCEAN);

const camera = new THREE.PerspectiveCamera(
    60,
	window.innerWidth/window.innerHeight,
    1,
    500000
);

camera.position.set(
    20000,
    15000,
    20000
);

const renderer = new THREE.WebGLRenderer({
    antialias:true
});

renderer.setSize(
    window.innerWidth,
    window.innerHeight
);

document.body.appendChild(
    renderer.domElement
);

const controls = new OrbitControls(
    camera,
    renderer.domElement
);

controls.enableDamping = true;
controls.minDistance = 100;
controls.maxDistance = 1000000;


const sun = new THREE.DirectionalLight(
    0xffffff,
    2
);

sun.position.set(
    10000,
    20000,
    10000
);

scene.add(sun);

scene.add(
    new THREE.AmbientLight(
        0xffffff,
        1
    )
);


/**************************************************
 * Geo Conversion (World Coordinate)
 **************************************************/

function lonLatToWorld(lon, lat){

    const R = 6378137;

    const x = R * THREE.MathUtils.degToRad(lon);

    const y = -R * Math.log(
				Math.tan(
					Math.PI/4 +
					THREE.MathUtils.degToRad(lat)/2
				)
			);

    return {x,y};
}


/**************************************************
 * Point In Polygon (Rasterization)
 **************************************************/

function pointInPolygon(x,y,polygon){

    let inside=false;

    for(
        let i=0,j=polygon.length-1;
        i<polygon.length;
        j=i++
    ){

        const xi=polygon[i][0];
        const yi=polygon[i][1];

        const xj=polygon[j][0];
        const yj=polygon[j][1];

        const intersect=

            ((yi>y)!=(yj>y))

            &&

            (
                x <
                (xj-xi)*(y-yi)/(yj-yi)
                + xi
            );

        if(intersect)
            inside=!inside;
    }

    return inside;
}

function sampleCell(x, y, polygon)
{
    const s = CELL_SIZE;

    let count = 0;

    const points = [

        [x + s*0.25, y + s*0.25],
        [x + s*0.75, y + s*0.25],

        [x + s*0.25, y + s*0.75],
        [x + s*0.75, y + s*0.75]

    ];

    for(const p of points)
    {
        if(
            pointInPolygon(
                p[0],
                p[1],
                polygon
            )
        ){
            count++;
        }
    }

    return count;
}  
 
function rasterizationWithRetreat(polygons, minX, maxX, minY, maxY, cellSize, retreat = 1) 
{
    // --- 1. 先用你原來的邏輯算出所有陸地 (用我上一版優化過的版本) ---
    const cols = Math.ceil((maxX - minX) / cellSize);
    const rows = Math.ceil((maxY - minY) / cellSize);
    const half = cellSize * 0.5;

    const polyBounds = polygons.map(poly => {
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
        for (const [x, y] of poly) {
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
            if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
        return { poly, bx0, bx1, by0, by1 };
    });

    const landSet = new Set(); // key: `${ix},${iy}`
    const landMap = new Map();  // key -> {x,y,cx,cy...}

    for (const { poly, bx0, bx1, by0, by1 } of polyBounds) {
        const ix0 = Math.max(0, Math.floor((bx0 - minX) / cellSize));
        const ix1 = Math.min(cols - 1, Math.floor((bx1 - minX) / cellSize));
        const iy0 = Math.max(0, Math.floor((by0 - minY) / cellSize));
        const iy1 = Math.min(rows - 1, Math.floor((by1 - minY) / cellSize));
        for (let ix = ix0; ix <= ix1; ix++) {
            for (let iy = iy0; iy <= iy1; iy++) {
                const key = `${ix},${iy}`;
                if (landSet.has(key)) continue;
                const cx = minX + ix * cellSize + half;
                const cy = minY + iy * cellSize + half;
                if (cx < bx0 || cx > bx1 || cy < by0 || cy > by1) continue;
                if (pointInPolygon(cx, cy, poly)) {
                    landSet.add(key);
                    landMap.set(key, { ix, iy, x: minX + ix * cellSize, y: minY + iy * cellSize, cx, cy, type: "land" });
                }
            }
        }
    }

    // --- 2. 向後退 retreat 格 ---
    // 4方向退 = 十字，8方向退 = 一圈都退，更自然
    const DIRS_4 = [[1,0],[-1,0],[0,1],[0,-1]];
    const DIRS_8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    const DIRS = DIRS_4; // 想退得狠一點用 8，想保留細尖角用 4

    let currentSet = landSet;
    for (let r = 0; r < retreat; r++) {
        const toRemove = [];
        for (const key of currentSet) {
            const [ix, iy] = key.split(',').map(Number);
            // 只要有一個鄰居不是陸地，它就是海岸線，要退掉
            for (const [dx, dy] of DIRS) {
                const nkey = `${ix + dx},${iy + dy}`;
                if (!currentSet.has(nkey)) {
                    toRemove.push(key);
                    break;
                }
            }
        }
        if (toRemove.length === 0) break;
        const nextSet = new Set(currentSet);
        toRemove.forEach(k => nextSet.delete(k));
        currentSet = nextSet;
    }

    return Array.from(currentSet).map(k => landMap.get(k));
}

/**************************************************
 * Load GeoJSON
 **************************************************/

async function load(){

    const geojson = await fetch(GEOJSON_URL).then(r=>r.json());

    const polygons=[];

    let minX=Infinity;
    let minY=Infinity;

    let maxX=-Infinity;
    let maxY=-Infinity;

    geojson.features.forEach(feature=>{

        const geometry = feature.geometry;

        if (geometry.type==="Polygon") {

            geometry.coordinates.forEach (
                ring => {
                    const poly=[];

                    ring.forEach(coord=>{

                        const p = lonLatToWorld(
                            coord[0],
                            coord[1]
                        );

                        poly.push([
                            p.x,
                            p.y
                        ]);

                        minX=Math.min(minX,p.x);
                        minY=Math.min(minY,p.y);

                        maxX=Math.max(maxX,p.x);
                        maxY=Math.max(maxY,p.y);

                    });

                    polygons.push(poly);
                }
            );
        }

        if (geometry.type === "MultiPolygon") {

            geometry.coordinates.forEach(
                polygon=>{
                    polygon.forEach(ring=>{

                        const poly=[];

                        ring.forEach(coord=>{
                            const p = lonLatToWorld(
                                coord[0],
                                coord[1]
                            );

                            poly.push([
                                p.x,
                                p.y
                            ]);

                            minX=Math.min(minX,p.x);
                            minY=Math.min(minY,p.y);

                            maxX=Math.max(maxX,p.x);
                            maxY=Math.max(maxY,p.y);

                        });

                        polygons.push(poly);

                    });
                }
            );
        }
    });

    const offsetX = (minX+maxX) * 0.5;
    const offsetY = (minY+maxY) * 0.5;

	//creare minecraft network 
	const land = rasterizationWithRetreat(polygons, minX, maxX, minY, maxY, CELL_SIZE, 1); 

	document.getElementById("landcell").innerHTML = "Land Cell: " + land.length;

	const DIRECTIONS8 = [

		[-1,-1],
		[ 0,-1],
		[ 1,-1],
		[-1, 0],
		[ 1, 0],
		[-1, 1],
		[ 0, 1],
		[ 1, 1]

	];

    const landMap = new Map();

	land.forEach(c => { landMap.set(`${c.x}_${c.y}`, c); });

    function exists(x,y) {
        return landMap.has( 
            `${x}_${y}`
        );
    }
 
	function isCoast(cell) {
		for(const dir of DIRECTIONS8)
		{
			const nx =
			   cell.x +
			   dir[0] *
			   CELL_SIZE;

			const ny =
			   cell.y +
			   dir[1] *
			   CELL_SIZE;

			if(
			   !landMap.has(
				  `${nx}_${ny}`
			   )
			){
				return true;
			}
		}

		return false;
	}


    /******************************
    * Coastline
    ******************************/ 

	const coast = [];

	let frontier = land.filter(isCoast);

	const beach = [];
	const beachSet = new Set();
 
	
	for(let depth=0;
			depth<COAST_WIDTH;
			depth++)
		{

		const next = [];

			frontier.forEach(cell=>{

			if(cell.type==="coast")
				return;

			cell.type="coast";

			coast.push(cell);
			
			const dirs = [

				[1,0],
                [-1,0],
                [0,1],
                [0,-1]

			];
 
			dirs.forEach( d => {
				const nx = cell.x + d[0]*CELL_SIZE;

				const ny = cell.y + d[1]*CELL_SIZE;

				const n = landMap.get(`${nx}_${ny}`);

				if (n && n.type !== "coast"){
					next.push(n);
				}
			});
		});

		frontier = next;
	}

    /******************************
     * Shallow Water
     ******************************/

    const shallowMap = new Map();

    coast.forEach( cell=>{
		 
		const dirs = [

			[1,0],
            [-1,0],
            [0,1],
            [0,-1]
		];

        dirs.forEach(d=>{

            const nx=
            cell.x +
            d[0]*CELL_SIZE;

            const ny=
            cell.y +
            d[1]*CELL_SIZE;

            if(!exists(nx,ny)){

                shallowMap.set(
                    `${nx}_${ny}`,
                    {x:nx,y:ny}
                );
            }
        });
    });

    const shallow = [...shallowMap.values()]; 
	
	createGrassLayer(
		land, 
		COLORS.LAND,
		LAND_HEIGHT
	);
 
	createInstancedLayer(
		coast,
		COLORS.COAST,
		COAST_HEIGHT
	);

    createInstancedLayer(
        shallow,
        COLORS.SHALLOW,
        SHALLOW_HEIGHT
    );


    /******************************
     * Ocean Plane
     ******************************/
	const oceanSize = Math.max(
		maxX-minX,
		maxY-minY
	) * 1.5;

    const ocean = new THREE.Mesh(

        new THREE.PlaneGeometry(
            oceanSize,
            oceanSize
        ),

        new THREE.MeshPhongMaterial({

            color: COLORS.OCEAN,
			transparent: true,
			opacity: MATERIALS.OCEAN_OPACITY

        })
    );

    ocean.rotation.x = -Math.PI/2;

    scene.add(ocean);


    /******************************
     * Center Map
     ******************************/

    scene.children.forEach(obj=>{

        if(obj.isMesh){
            obj.position.x -= offsetX;
            obj.position.z -= offsetY;
        } 
    }); 
}

function createGrassLayer(cells, color, height)
{ 
	const pureLand = cells.filter(
			c => c.type !== "coast"
		);
		
	const grassTopMaterial = new THREE.MeshLambertMaterial({
		color: COLORS.LAND_TOP
	});

	const dirtMaterial = new THREE.MeshLambertMaterial({
		color: COLORS.LAND_SIDE
	});

	const landMaterials = [
		dirtMaterial,      // right
		dirtMaterial,      // left
		grassTopMaterial,  // top
		dirtMaterial,      // bottom
		dirtMaterial,      // front
		dirtMaterial       // back
	]; 
	
	const geometry = new THREE.BoxGeometry(
		1,
		1,
		1
	);

	const mesh = new THREE.InstancedMesh(
		geometry,
		landMaterials,
		pureLand.length
	); 

    const cube = new THREE.Object3D();

	pureLand.forEach((cell, i) => {

		cube.position.set(
			cell.x,
			height * CELL_SIZE * 0.5,
			cell.y
		);

		cube.scale.set(
			CELL_SIZE,
			CELL_SIZE * height,
			CELL_SIZE
		);
 
		cube.updateMatrix();
		
		mesh.setMatrixAt(
			i,
			cube.matrix
		);
	});

    mesh.instanceMatrix.needsUpdate = true; 

    scene.add(mesh);
}

function createInstancedLayer(cells, color, height) {

    const geometry = new THREE.BoxGeometry(
        CELL_SIZE,
        CELL_SIZE*height,
        CELL_SIZE
    );

    const material=  new THREE.MeshLambertMaterial({
        color
    });

    const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        cells.length
    );

    const matrix = new THREE.Matrix4();

    cells.forEach((cell,i)=>{

        matrix.makeTranslation(
			cell.x,
            CELL_SIZE*height/2,
            cell.y
        );

        mesh.setMatrixAt(i,matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;

    scene.add(mesh);
}

window.addEventListener(
    "resize",
    () => {
        camera.aspect = window.innerWidth / window.innerHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
            window.innerWidth,
            window.innerHeight
        );
    }
);

load();

function animate(){

    requestAnimationFrame(
        animate
    );

    controls.update();

    renderer.render(
        scene,
        camera
    );
}

animate();
 