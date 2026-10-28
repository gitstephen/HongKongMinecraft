import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';

/**************************************************
 * Config
 **************************************************/

const CELL_SIZE = 300; 

const LAND_HEIGHT = 2;
const COAST_HEIGHT = 1; 
const COAST_WIDTH = 1;
const WATER_HEIGHT = 0.5;

/* Color */

const COLORS = {
    LAND: 0x55aa55,  // Minecraft 草地
	LAND_TOP:0x74b85b,
    LAND_SIDE:0x8b5a2b,	
    DIRT: 0x8b5a2b,
    COAST: 0xe6cf7a,
    SHALLOW: 0x4fc3f7,
    OCEAN: 0x0A4498,
    SKY: 0xb3e5fc
};

const MATERIALS = {
    LAND_OPACITY: 1.0,
    SHALLOW_OPACITY: 0.75,
    OCEAN_OPACITY: 0.85
};

const GEOJSON_URL = "./hk_coast.json";
const MOUNT_URL = "./hk_mount.json";


/**************************************************
 * Geo Conversion (World Coordinate)
 **************************************************/

const WORLD_CENTER = {
  lon: 114.15, // 香港中心經度
  lat: 22.35   // 香港中心緯度
}

const R = 6378137;

const lonLatToWorld = (lon, lat) => {
    const x = R * THREE.MathUtils.degToRad(lon);
    const y = R * Math.log(Math.tan(Math.PI/4 + THREE.MathUtils.degToRad(lat)/2)); // 用正Y
    
	return {x, y};
} 
	
/**************************************************
 * Scene
 **************************************************/

const scene = new THREE.Scene();

scene.background = new THREE.Color(COLORS.OCEAN);

const camera = new THREE.PerspectiveCamera(
    45,
	window.innerWidth/window.innerHeight,
    0.1,
    10000
);

//45
camera.position.set(
    0,
    180,
    180
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
controls.minDistance = 10;
controls.maxDistance = 1000;


const sun = new THREE.DirectionalLight(
    0xffffff,
    2
);

sun.position.set(
    1000,
    2000,
    1000
);

scene.add(sun);

scene.add(
    new THREE.AmbientLight(
        0xffffff,
        0.5
    )
);

scene.add(
    new THREE.DirectionalLight(
		0xffffff, 
		1
	)
);


 /**************************************************
 * Point In Polygon (Rasterization)
 **************************************************/

function pointInPolygon(lon, lat, poly){
    let inside = false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi)*(lat - yi)/(yj - yi + 1e-12) + xi);
        if(intersect) inside = !inside;
    }
	
    return inside;
}
   
/*********************************
* Add texture
*********************************/

function loadTexture(file) {
	const texture = textureLoader.load(
		file
	);
	
	texture.colorSpace = THREE.SRGBColorSpace;
	//texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
	
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;

	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	
	texture.repeat.set(1,1); 
	
	return texture;
}	

const textureLoader = new THREE.TextureLoader(); 

//Beach
const sandTopTexture = loadTexture(
		"./images/sand_top.png"
	);	

const sandSideTexture = loadTexture(
		"./images/sand_side.png"
	); 

const makeMaterial = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0 });
const makeAlphaMaterial = (map, a) => new THREE.MeshStandardMaterial({ 
		map, 
		roughness: 0.8, 
		metalness: 0, 
		transparent: true,
		opacity: 0.5
	});

const beachMaterials = [
	//+X 右面 right
	makeMaterial(sandSideTexture),
	//-X 左面 left
	makeMaterial(sandSideTexture),
	//+Y 上面 top
	makeMaterial(sandTopTexture),
	// -Y 下面 bottom
	makeMaterial(sandSideTexture),
	//+Z 前面 front
	makeMaterial(sandSideTexture),
	//-Z 後面 back
	makeMaterial(sandSideTexture)  
];

//LAND
const landTopText = loadTexture(
		"./images/green_concrete_powder.png"
	);	

const landSideText = loadTexture(
		"./images/grass_block_side.png"
	);	
	
const landBottomText = 	loadTexture(
		"./images/brown_concrete_powder.png"
	);	
	
const landMaterials = [
	//+X 右面 right
	makeMaterial(landSideText),
	//-X 左面 left
	makeMaterial(landSideText),
	//+Y 上面 top
	makeMaterial(landTopText),
	// -Y 下面 bottom
	makeMaterial(landBottomText),
	//+Z 前面 front
	makeMaterial(landSideText),
	//-Z 後面 back
	makeMaterial(landSideText)   
];
	
//Water
const waterTopText = loadTexture(
		"./images/light_blue_wool.png"
	);	
	
const waterMaterials = [
	//+X 右面 right
	makeAlphaMaterial(waterTopText, 0.75),
	//-X 左面 left
	makeAlphaMaterial(waterTopText, 0.75),
	//+Y 上面 top
	makeAlphaMaterial(waterTopText, 1),
	// -Y 下面 bottom
	makeAlphaMaterial(waterTopText, 0.75),
	//+Z 前面 front
	makeAlphaMaterial(waterTopText, 0.75),
	//-Z 後面 back
	makeAlphaMaterial(waterTopText, 0.75)   
];	
	
/**************************************************
 * Load GeoJSON
 **************************************************/
	
// 你陸地格子對應香港的真實範圍，你改成你自己地圖的範圍就行
const HK_BOUNDS = {
  minLon: 113.8,
  maxLon: 114.4,
  minLat: 22.15,
  maxLat: 22.55
}	 

function setPosition(mesh, blocks, height) {
	const matrix = new THREE.Matrix4();

    blocks.forEach((cell,i)=>{
        matrix.makeTranslation(
			cell.x,
            CELL_SIZE*height/2,
            cell.y
        );

        mesh.setMatrixAt(i,matrix);
    }); 

} 

function createInstancedLayer(cells, color, height) {

    const geometry = new THREE.BoxGeometry(
        CELL_SIZE,
        CELL_SIZE*height,
        CELL_SIZE
    );

    const material = new THREE.MeshLambertMaterial({
        color
    });

    const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        cells.length
    );
 
    setPosition(mesh, cells, height);
	
    scene.add(mesh);
}

function createTextureLayer(cells, textures, height) {

    const geometry = new THREE.BoxGeometry(
        CELL_SIZE,
        CELL_SIZE*height,
        CELL_SIZE
    ); 

    const mesh = new THREE.InstancedMesh(
        geometry,
        textures,
        cells.length
    ); 
	
	setPosition(mesh, cells, height);
	    
    scene.add(mesh);
}

function getBorderCells(set){
	const border = new Set();
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
	
	for(const k of set){
		const [x,y] = k.split(',').map(Number);
		for(const [dx,dy] of DIRECTIONS8){
			if(!set.has(`${x+dx},${y+dy}`)){
				border.add(k);
				break;
			}
		}
	}
	return border;
}
 

async function loadJson(gs) {
 
	const landCells = [];

	// 1. 陸地 - 每格1個Box
	const hkGeo = await fetch(gs).then(r=>r.json()); 
  
	// 計出香港範圍，作為原點
	let minLon=180, maxLon=-180, minLat=90, maxLat=-90;
	
	const allPolys = [];
	
	for(const f of hkGeo.features){
		const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p=>p[0])
		for(const poly of polys){
			allPolys.push(poly)
			for(const [lon,lat] of poly){
				minLon=Math.min(minLon,lon); 
				maxLon=Math.max(maxLon,lon);
				minLat=Math.min(minLat,lat); 
				maxLat=Math.max(maxLat,lat);
			}
		}
	}
	
	const origin = lonLatToWorld(minLon, minLat);
	const maxM = lonLatToWorld(maxLon, maxLat);
	
	const widthM = maxM.x - origin.x;
	const heightM = maxM.y - origin.y;
	
	const COLS = Math.ceil(widthM / CELL_SIZE);
	const ROWS = Math.ceil(heightM / CELL_SIZE); 
	const centerX = COLS/2, centerY = ROWS/2;
	
	
	// ===== 5. 生成整個香港陸地，綠色 Box ===== 	

	for(let r=0; r<ROWS; r++){
		for(let c=0;c<COLS;c++){
			const lon = minLon + (c+0.5)/COLS*(maxLon-minLon);
			const lat = minLat + (r+0.5)/ROWS*(maxLat-minLat);
			for(const poly of allPolys){
				if(pointInPolygon(lon, lat, poly)){
					landCells.push({x:c, y:r});
					break;
				}
			}
		}
	}
	
  	const originalLandSet = new Set(landCells.map(c=>`${c.x},${c.y}`))
	  

	/*********************************
	* Land
	*********************************/	
	
	const borderCells = getBorderCells(originalLandSet); // 最外圈海岸
	const innerLandSet = new Set([...originalLandSet].filter(k=>!borderCells.has(k))); // 退縮後嘅陸地
	const beachSet = borderCells; // 沙灘 = 原本最外圈
	
	document.getElementById("landcell").innerHTML = "Land: " + innerLandSet.size + ", Coast: " + borderCells.size;
	
	// 用 InstancedMesh 高效渲染
	const landGeo = new THREE.BoxGeometry(1, LAND_HEIGHT, 1); 
	const landMesh = new THREE.InstancedMesh(landGeo, landMaterials, landCells.length);
 
	const dummy = new THREE.Object3D();
	
	let land_index = 0;
	for(const k of innerLandSet){
		const [x,y] = k.split(',').map(Number);
		dummy.position.set(x - centerX, 0, -(y - centerY));
		dummy.updateMatrix();
		landMesh.setMatrixAt(land_index++, dummy.matrix);
	}
	
	landMesh.instanceMatrix.needsUpdate = true;
	scene.add(landMesh)
 	
	/*********************************
	* Coast
	*********************************/	 
	const beachGeo = new THREE.BoxGeometry(1, COAST_HEIGHT, 1);	 
	const beachMesh = new THREE.InstancedMesh(beachGeo, beachMaterials, beachSet.size);
	 
	let coast_index = 0;
	for(const k of beachSet){
		const [x,y] = k.split(',').map(Number);
		dummy.position.set(x - centerX, -0.5, -(y - centerY));
		dummy.updateMatrix();
		beachMesh.setMatrixAt(coast_index++, dummy.matrix);
	}
 
	beachMesh.instanceMatrix.needsUpdate = true; 
	scene.add(beachMesh);
	
	
	/*********************************
	* Water
	*********************************/	
	const landSet = innerLandSet; 

	// ===== 6. 外圍加一格淺水區 (沙灘外面) =====
	function getShallowRing(){
		const shallow = new Set()
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
		const combinedSet = new Set([...innerLandSet, ...beachSet]) // 陸地+沙灘外面先係水
		for(const k of combinedSet){
			const [x,z] = k.split(',').map(Number)
			for(const [dx,dz] of DIRECTIONS8){
				const nk = `${x+dx},${z+dz}`
				if(!combinedSet.has(nk)) shallow.add(nk)
			}
		}
		return shallow
	}
	
	const shallowSet = getShallowRing();
	
	const shallowGeo = new THREE.BoxGeometry(1, WATER_HEIGHT, 1);
    const shallowMesh = new THREE.InstancedMesh(shallowGeo, waterMaterials, shallowSet.size);
	
	let water_index = 0;
	
	for(const k of shallowSet){
		const [x,y] = k.split(',').map(Number);
		dummy.position.set(x-centerX, -0.75, -(y-centerY));
		dummy.updateMatrix();
		shallowMesh.setMatrixAt(water_index++, dummy.matrix);
	}
	
	shallowMesh.instanceMatrix.needsUpdate = true; 
	scene.add(shallowMesh);
}
 

loadJson(GEOJSON_URL);


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

animate();
 