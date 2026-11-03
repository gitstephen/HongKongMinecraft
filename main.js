import * as THREE from './scripts/three.module.js';
import { OrbitControls } from './scripts/OrbitControls.js';


/**************************************************
 * Config
 **************************************************/
const GEOJSON_URL = "/hk_coast.json";
const MOUNT_URL = "/hk_mount.json";

const CELL_SIZE = 300; 
const OCEAN_SIZE = 1000; // 無限大，用10000格=3000km，遠超可視範圍

const LAND_HEIGHT = 2;
const COAST_HEIGHT = 1.5; 
const WATER_HEIGHT = 1; 

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

const COLORS = { 
    SKY_TOP: '#87A9FE',
	SKY_BOTTOM: '#AAD0FC',
	OCEAN: '#082656'
};

const MATERIALS = {
    LAND_OPACITY: 1.0,
    SHALLOW_OPACITY: 0.75,
    OCEAN_OPACITY: 0.85
};

//For standard Web Mercator
const R = 6378137; 

function lonLatToWorld(lon, lat) {	 
	const lonRad = THREE.MathUtils.degToRad(lon);
    const latRad = THREE.MathUtils.degToRad(lat);
	
    const x = R * lonRad;
    const y = R * Math.log(Math.tan(Math.PI/4 + latRad/2)); 
	
    return {x, y};
} 

function worldToLonLat(x, y) {
	const lon = THREE.MathUtils.radToDeg(x / R);
	const lat = THREE.MathUtils.radToDeg(
		2 * Math.atan(Math.exp(y / R)) - Math.PI / 2
	);

	return { lon, lat };
}

// ===== 2. 點是否在多邊形內 (用於將geojson轉格子) =====
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

const makeMaterial = (map) => new THREE.MeshLambertMaterial({ map, flatShading: true });
const makeAlphaMaterial = (map, a) => new THREE.MeshStandardMaterial({ 
		map, 
		roughness: 0.8, 
		metalness: 0, 
		transparent: true,
		opacity: a
	});	 

// ===== 3. Three.js 場景 =====
const scene = new THREE.Scene(); 
const camera = new THREE.PerspectiveCamera(
	75,
	window.innerWidth / window.innerHeight,
	1,   // near - 最近睇到幾多，唔好<0.1會閃
	1000   // far - 最遠睇到幾多，你無限海就靠佢
);

const renderer = new THREE.WebGLRenderer({ antialias:true });
	
async function load() {
	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 512;

	//Make SKY
	const ctx = canvas.getContext('2d');
	const gradient = ctx.createLinearGradient(0, 0, 0, 512);

	gradient.addColorStop(0, COLORS.SKY_TOP); // 天空藍 - 頂部
	gradient.addColorStop(0.75, '#A8D8EA'); // 淺藍
	gradient.addColorStop(1, COLORS.SKY_BOTTOM); // 接近白色 - 底部

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 2, 512);
	
	scene.background = new THREE.CanvasTexture(canvas);
	scene.fog = new THREE.Fog(0x87CEEB, 100, 700);

	// 修正視角：整個香港 210x154格，剛好置中
	// 相機拉高拉遠，俯視 45度，最適合睇全島
	camera.position.set(0, 180, 180);
	camera.lookAt(0, 0, 0);

	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(scene.fog.color); 			

	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;//
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	document.body.appendChild(renderer.domElement) 

	//1. Add Lighting
	scene.add(new THREE.AmbientLight(0xffffff, 0.6));

	//2. 半球光 - Minecraft 靈魂！
	//天空係藍色，地面係暖黃色，令方塊立體感即刻出嚟
	const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x362d1d, 0.8);
	hemiLight.position.set(0, 50, 0);
	scene.add(hemiLight);

	const sunLight = new THREE.DirectionalLight(0xffffff, 1.3);
	sunLight.position.set(100, 200, 100);
	sunLight.castShadow = true;
	// 陰影優化 - 好重要，如果唔設，你1500格嘅海會卡死
	sunLight.shadow.mapSize.width = 2048;
	sunLight.shadow.mapSize.height = 2048;
	sunLight.shadow.camera.near = 0.5;
	sunLight.shadow.camera.far = 500;
	sunLight.shadow.camera.left = -200;
	sunLight.shadow.camera.right = 200;
	sunLight.shadow.camera.top = 200;
	sunLight.shadow.camera.bottom = -200;

	scene.add(sunLight);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;// 有慣性，順好多
	controls.dampingFactor = 0.08;
	controls.enablePan = false; // 唔俾佢平移穿過地

	controls.target.set(0, 0, 0);
	controls.minDistance = 10;
	controls.maxDistance = 200;
	controls.maxPolarAngle = Math.PI / 2 - 0.05;// 唔俾超過水平線
	controls.minPolarAngle = 0.1;
	controls.enableZoom = true;
	controls.zoomSpeed = 1;

	controls.update(); 

	// 自動適應大小，保證開始就睇到全島
	function fitCameraToGrid(cols, rows){
		const maxDim = Math.max(cols, rows);
		const dist = maxDim * 0.9; // 根據格子大小自動計距離
		camera.position.set(0, dist * 0.9, dist * 0.85);
		controls.target.set(0, 0, 0);
		controls.update();
	}

	// ===== 4. 載入原本 geojson，原檔完全唔改 =====
	const [hkRes, mountRes] = await Promise.all([
		fetch(GEOJSON_URL),
		fetch(MOUNT_URL)
	]);

	const hkGeo = await hkRes.json();
	const mountGeo = await mountRes.json();

	// 計出香港範圍，作為原點 (喺代碼計，唔寫死喺json)
	let minLon=180, maxLon=-180, minLat=90, maxLat=-90;
	const allPolys = []; 

	for(const f of hkGeo.features){
		const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p=>p[0]);
		for(const poly of polys){
			allPolys.push(poly);
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

	console.log(`香港 ${COLS}x${ROWS} 格`)
	 
	function lonLatToGrid(lon, lat){
		const w = lonLatToWorld(lon, lat); 
		return {
			gridX: Math.floor((w.x - origin.x) / CELL_SIZE),
			gridZ: Math.floor((w.y - origin.y) / CELL_SIZE),
			worldX: (w.x - origin.x) / CELL_SIZE,
			worldZ: (w.y - origin.y) / CELL_SIZE // // Minecraft的Z是向南为正，墨卡托Y向北为正，所以要反一下
		}
	}

	const dummy = new THREE.Object3D();
	  
	// ===== 5  海洋 - 香港面3倍大，喺陸地外面 =====
	// 生成 Minecraft 風格海水貼圖 

	function createWaterTexture(tileSize, baseColor) {
		const size = 16;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = baseColor;
		ctx.fillRect(0,0,size,size);
		const colors = ['#081F4D', '#123A75', '#0D2E5F', '#184B8C'];
		for(let i=0; i<60; i++){
			ctx.fillStyle = colors[Math.floor(Math.random()*colors.length)];
			ctx.fillRect(Math.floor(Math.random()*size), Math.floor(Math.random()*size), 1, 1);
		}
		const tex = new THREE.CanvasTexture(canvas);
		tex.magFilter = tex.minFilter = THREE.NearestFilter;
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(OCEAN_SIZE / tileSize, OCEAN_SIZE / tileSize);
		return tex;
	}
		// --- 1. 下層：深海底層 (唔透明，壓底) ---
		// 共用方法，唔使寫兩次 PlaneGeometry
	const createOceanLayer = (color, y, opts = {}) => {
		const mat = new THREE.MeshLambertMaterial({
			map: createWaterTexture(32, color), 
			transparent: opts.transparent ?? true,
			opacity: opts.opacity ?? 1 
		});
		mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;

		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 1, 1),
			mat
		);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(0, y, 0);
		mesh.renderOrder = opts.renderOrder ?? 0;
		mesh.receiveShadow = false;
		return { mesh, mat };
	};

	// 1. 下層：深海底層 - 完全唔透，當背景色
	const { mesh: deepMesh } = createOceanLayer(COLORS.OCEAN, -1.5, {	 
		transparent: false,	 
		opacity: 1,
		renderOrder: 0
	});

	// 2. 上層：淺水表層 - 半透明
	const { mesh: surfaceMesh, mat: shallowMat } = createOceanLayer('#2A7FBE', -0.75, { 
		transparent: true,
		opacity: 0.5,
		renderOrder: 1
	});

	scene.add(deepMesh, surfaceMesh);
  

	fitCameraToGrid(COLS * 2, ROWS * 2) // 睇大啲，見到無限海  

	// ===== 5.1 生成整個香港陸地，綠色 Box (優化版) =====
	const landCells = [];
	const seen = new Set(); 

	// 1. 預先計算每個 polygon 的 bbox，轉做格子範圍，唔使掃全地圖
	const polyBounds = allPolys.map(poly => {
		let minGridX = COLS, maxGridX = 0, minGridZ = ROWS, maxGridZ = 0;

		for (const [lon, lat] of poly) {
			const { gridX, gridZ } = lonLatToGrid(lon, lat);

			minGridX = Math.min(minGridX, gridX);
			maxGridX = Math.max(maxGridX, gridX);
			minGridZ = Math.min(minGridZ, gridZ);
			maxGridZ = Math.max(maxGridZ, gridZ);
		}

		return {
			poly,
			c0: Math.max(0, minGridX),
			c1: Math.min(COLS - 1, maxGridX),
			r0: Math.max(0, minGridZ),
			r1: Math.min(ROWS - 1, maxGridZ)
		};
	});

	// 2. 反向遍歷：對每個 poly，只掃佢 bbox 入面嘅格子
	for (const { poly, c0, c1, r0, r1 } of polyBounds) {
		for (let r = r0; r <= r1; r++) {
			//const lat = minLat + (r + 0.5) / ROWS * (maxLat - minLat);

			for (let c = c0; c <= c1; c++) {
				const key = `${c},${r}`;

				if (seen.has(key)) {
					continue;
				}

				const worldX = origin.x + (c + 0.5) * CELL_SIZE;
				const worldY = origin.y + (r + 0.5) * CELL_SIZE;
				const { lon, lat } = worldToLonLat(worldX, worldY);

				//const lon = minLon + (c + 0.5) / COLS * (maxLon - minLon);
				if (pointInPolygon(lon, lat, poly)) {
					landCells.push({ x: c, z: r });
					seen.add(key);
				}
			}
		}
	}  

	// landSet 用於之後計 coast 和沙灘
	const originalLandSet = new Set(landCells.map(c=>`${c.x},${c.z}`));

	// ===== 5.1 陸地退縮一格，空出嚟做沙灘 =====
	function getBorderCells(set){
		const border = new Set();
	 
		for(const k of set){
			const [x,z] = k.split(',').map(Number);
			for(const [dx,dz] of DIRECTIONS8){
				if(!set.has(`${x+dx},${z+dz}`)){
					border.add(k);
					break;
				}
			}
		}
		return border;
	}

	const borderCells = getBorderCells(originalLandSet); // 最外圈海岸
	const innerLandSet = new Set([...originalLandSet].filter(k=>!borderCells.has(k))); // 退縮後嘅陸地
	const beachSet = borderCells; // 沙灘 = 原本最外圈

	console.log(`總方格: ${landCells.length} = 內陸 ${innerLandSet.size} + 沙灘 ${beachSet.size}`)

	// 內陸 - 綠色 Box
	const landGeo = new THREE.BoxGeometry(1, LAND_HEIGHT, 1);
	//LAND
	const matTextures = {
		side: makeMaterial(loadTexture("./images/grass_block.png")),
		top: makeMaterial(loadTexture("./images/grass_top.png")),
		bottom: makeMaterial(loadTexture("./images/brown_concrete_powder.png")),
	};

	const landMaterials = [
		matTextures.side, 
		matTextures.side, 
		matTextures.top, 
		matTextures.bottom, 
		matTextures.side, 
		matTextures.side
	];

	const landMesh = new THREE.InstancedMesh(landGeo, landMaterials, innerLandSet.size);
	landMesh.castShadow = true;
	landMesh.receiveShadow = true; 
	 
	const centerX = COLS/2, centerZ = ROWS/2; 

	let li=0;
	for(const k of innerLandSet){
		const [x,z] = k.split(',').map(Number);
		dummy.position.set(x - centerX, 0, centerZ - z);
		dummy.updateMatrix();
		landMesh.setMatrixAt(li++, dummy.matrix);
	}
	scene.add(landMesh);

	// 沙灘 - 沙色 Box
	const beachGeo = new THREE.BoxGeometry(1, COAST_HEIGHT, 1);  

	const beachTexs = {
		side: makeMaterial(loadTexture("./images/sand_side.png")),
		top: makeMaterial(loadTexture("./images/sand_top.png"))	 
	};
	
	const beachMaterials = [beachTexs.side, beachTexs.side, beachTexs.top, beachTexs.side, beachTexs.side, beachTexs.side];
	
	const beachMesh = new THREE.InstancedMesh(beachGeo, beachMaterials, beachSet.size);
	beachMesh.receiveShadow = false;

	let bi=0;
	for(const k of beachSet){
		const [x,z] = k.split(',').map(Number);
		dummy.position.set(x - centerX, -0.5, centerZ - z); // 比陸地矮少少
		dummy.updateMatrix();
		beachMesh.setMatrixAt(bi++, dummy.matrix);
	}
	scene.add(beachMesh);

	const landSet = innerLandSet; // 之後淺水用內陸做基準

	// ===== 6. 外圍加一格淺水區 (沙灘外面) =====
	function getShallowRing(){
		const shallow = new Set();
	 
		const combinedSet = new Set([...innerLandSet, ...beachSet]); // 陸地+沙灘外面先係水
		for(const k of combinedSet){
			const [x,z] = k.split(',').map(Number);
			for(const [dx,dz] of DIRECTIONS8){
				const nk = `${x+dx},${z+dz}`;
				if(!combinedSet.has(nk)) shallow.add(nk);
			}
		}
		return shallow;
	}

	const shallowSet = getShallowRing();
	const shallowGeo = new THREE.BoxGeometry(1, WATER_HEIGHT, 1);
	//water texture 
	const waterTopText = loadTexture(
			"./images/light_blue_wool.png"
		);	 
 
	const waterMaterials =  makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY);
 	
	const beachwMesh = new THREE.InstancedMesh(shallowGeo, waterMaterials, shallowSet.size);

	let si=0;
	for(const k of shallowSet){
		const [x,z] = k.split(',').map(Number);
		dummy.position.set(x-centerX, -0.85,  centerZ - z);
		dummy.updateMatrix();
		beachwMesh.setMatrixAt(si++, dummy.matrix);
	}
	scene.add(beachwMesh);

	// ===== 7. 高山 - 用原本 mount.json，比例喺代碼計 =====  
	const LAND_SURFACE_Y = LAND_HEIGHT / 2;  // 綠色陸地 Box 0.6高，頂部 0.3
	//const BEACH_SURFACE_Y = 1; // 沙灘 Box 0.35高，位置-0.12，頂部 0.055

	function makeTextSprite(name, elevation){
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		const fontSize = 48;
		const lineGap = 14;
		const paddingX = 32;
		const paddingY = 16;
		const radius = 18;

		const line1 = name;
		const line2 = `${elevation}m`;

		ctx.font = `bold ${fontSize}px 'Noto Sans HK', sans-serif`;
		const m1 = ctx.measureText(line1);
		const m2 = ctx.measureText(line2);
		const maxWidth = Math.max(m1.width, m2.width);

		canvas.width = maxWidth + paddingX * 2;
		canvas.height = fontSize * 2 + lineGap + paddingY * 2;

		// 重設樣式 (width 重置會清空 ctx)
		ctx.font = `bold ${fontSize}px 'Noto Sans HK', sans-serif`;
		ctx.textAlign = 'center'; // 關鍵：置中
		ctx.textBaseline = 'middle';

		// 背景
		ctx.fillStyle = 'rgba(0,0,0,0.55)';
		ctx.beginPath();
		ctx.roundRect(0, 0, canvas.width, canvas.height, radius);
		ctx.fill();

		// 文字
		ctx.fillStyle = '#FFFFFF';
		ctx.shadowColor = 'rgba(0,0,0,0.5)';
		ctx.shadowOffsetY = 1;

		const centerY = canvas.height / 2 - 10;
		const centerX = canvas.width / 2; // 關鍵：用中心點
		const line1Y = centerY - (fontSize + lineGap) / 2 + fontSize/2;
		const line2Y = centerY + (fontSize + lineGap) / 2 - fontSize/2;

		ctx.fillText(line1, centerX, line1Y );

		ctx.font = `36px 'Noto Sans HK', sans-serif`;
		ctx.fillText(line2, centerX, line2Y + 30);

		const tex = new THREE.CanvasTexture(canvas);
		const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
		const sprite = new THREE.Sprite(mat);
		sprite.scale.set(canvas.width/28, canvas.height/28, 1);
		sprite.renderOrder = 999;

		return sprite;
	}

	const stoneTex = {
		side: makeMaterial(loadTexture("./images/brown_concrete_powder.png")),
		top: makeMaterial(loadTexture("./images/green_wool.png")),
		bottom: makeMaterial(loadTexture("./images/rock_block3.png"))
	}; 
	
	const soilMaterials = [
		stoneTex.side, 
		stoneTex.side, 
		stoneTex.top, 
		stoneTex.bottom, 
		stoneTex.side, 
		stoneTex.side
	]; 
	
	const solidMatedrials = [
		stoneTex.side, 
		stoneTex.side, 
		stoneTex.bottom, 
		stoneTex.bottom, 
		stoneTex.side, 
		stoneTex.side
	];  
	
	const landData = [];
	const baseData = [];	
	const topData = [];
	const BLOCK_SIZE = 150; // 957 / 50 = 19.14，你之前 150 太大，變到成個山得幾格
	const LAYER = 3;
	const XZ_SCALE = 1;
	const columnMax = new Map(); // key: "gx,gz" -> maxY
	 
	const trunkData = [];
	const leavesData = [];
	
	const woodCubes = []; // 所有樹幹方塊
	const leafCubes = []; // 所有樹葉方塊

	mountGeo.features.forEach(f => {
		const [lon, lat] = f.geometry.coordinates;
		const { elevation, name } = f.properties;
		const grid = lonLatToGrid(lon, lat);
		const mh = Math.max(LAYER, Math.round(elevation / BLOCK_SIZE));
		const baseRadius = mh * 0.7;
		const worldX = grid.worldX - centerX;
		const worldZ = centerZ - grid.worldZ;
		for (let y = 0; y <= mh; y++) {
			const progress = y / mh;
			const radius = baseRadius * (1 - progress * 0.85);
			const r = Math.ceil(radius);
			for (let dx = -r; dx <= r; dx++) {
				for (let dz = -r; dz <= r; dz++) {
					const distSq = dx*dx + dz*dz;
					if (distSq > radius * radius) continue;
					// 只留外殼 + 頂，唔要入面實心
					const isEdge = distSq > (radius - 1.2) * (radius - 1.2);
					if (!isEdge && y < mh - 1) continue;
					const gx = worldX + dx * XZ_SCALE;
					const gz = worldZ + dz * XZ_SCALE;
					const key = `${Math.round(gx / XZ_SCALE)},${Math.round(gz / XZ_SCALE)}`;
					// 如果呢條柱已經有更高嘅山，就skip
					if ((columnMax.get(key) ?? -1) > y) continue;
					columnMax.set(key, y);
					const pos = {
						x: gx,
						y: LAND_SURFACE_Y + y + 0.5,
						z: gz
					};
					if (y === mh) topData.push(pos);
					else if (y === mh - 1) landData.push(pos); // 山頂下一層做草
					else baseData.push(pos);
				}
			}
		}
		const label = makeTextSprite(name, elevation);
		label.position.set(worldX, LAND_SURFACE_Y + mh + 4, worldZ);
		scene.add(label);
		
		// --- 在山丘周圍加樹 --- 

		// --- 方塊樹 ---
		const TREE_COUNT = Math.round(mh * 1.5); // 大帽山 ~34棵
		const minRadius = baseRadius * 1.1 + 1;
		const maxRadius = baseRadius * 2.0; 

		for (let i = 0; i < TREE_COUNT; i++) {
			const angle = Math.random() * Math.PI * 2;
			const r = minRadius + Math.sqrt(Math.random()) * (maxRadius - minRadius);
			
			const dx = Math.cos(angle) * r;
			const dz = Math.sin(angle) * r;
			
			const gx = worldX + dx * XZ_SCALE;
			const gz = worldZ + dz * XZ_SCALE;
			
			const key = `${Math.round(gx / XZ_SCALE)},${Math.round(gz / XZ_SCALE)}`;
			if (columnMax.has(key)) continue;
			
			const baseY = LAND_SURFACE_Y;
			
			// --- A. 樹幹，2格高 ---
			const HALF = 0.5;
			
			// --- 隨機高度：2 ~ 5格 ---
			const trunkHeight = 2 + Math.floor(Math.random() * 3); // 2,3,4,5
			// 有啲樹想佢特別高，例如 10% 機會變大樹
			const isBigTree = Math.random() < 0.1;
			const finalHeight = isBigTree ? trunkHeight + 2 : trunkHeight;
			// A. 樹幹
			for (let ty = 0; ty < finalHeight; ty++) {
				woodCubes.push({
					x: gx,
					y: baseY + ty * HALF + HALF/2,
					z: gz
				});
			}
			// B. 樹葉，喺樹頂
			const leafBaseY = baseY + finalHeight * HALF;
			const leafLayers = isBigTree ? 3 : 2; // 大樹葉多一層
			for (let ly = 0; ly < leafLayers; ly++) {
				for (let lx = -1; lx <= 1; lx++) {
					for (let lz = -1; lz <= 1; lz++) {
						// 頂層削角，似返棵樹
						if (ly === leafLayers - 1 && Math.abs(lx) === 1 && Math.abs(lz) === 1) {
							if (Math.random() < 0.6) continue; // 隨機削，唔會太四方
						}
						// 最底層中間留個窿接樹幹
						if (ly === 0 && lx === 0 && lz === 0) continue;
						leafCubes.push({
							x: gx + lx * XZ_SCALE * HALF,
							y: leafBaseY + ly * HALF + HALF/2,
							z: gz + lz * XZ_SCALE * HALF
						});
					}
				}
			}
			
			columnMax.set(key, 0); // 佔位
		}
	});
	
	// --- Mesh 建立 ---	
	function makeHillInstanced(data, mat, scale) {
		if (!data.length) return null;	
		const terraGeo = new THREE.BoxGeometry(1, 1, 1);
		const mesh = new THREE.InstancedMesh(terraGeo, mat, data.length);
		 
		data.forEach((p, i) => {
			dummy.position.set(p.x, p.y, p.z);
			dummy.scale.set(scale.z, scale.y, scale.z);
			dummy.updateMatrix();
			mesh.setMatrixAt(i, dummy.matrix);
		});
		mesh.instanceMatrix.needsUpdate = true;
		mesh.frustumCulled = false; // 大地形一定要關，否則computeBoundingSphere會cut走
		mesh.castShadow = true; // 樹葉都投射，影會更密
		mesh.receiveShadow = true;
		mesh.computeBoundingSphere();
		return mesh;
	}  
	
	const hillScale = {x: XZ_SCALE, y:1, z: XZ_SCALE};
	
	const baseMesh = makeHillInstanced(baseData, soilMaterials, hillScale); 
	const soilMesh = makeHillInstanced(landData, solidMatedrials, hillScale); 
	const peakMesh = makeHillInstanced(topData, stoneTex.bottom, hillScale); 
	
	scene.add(baseMesh, soilMesh, peakMesh);	
    
	const woodMaterial = new THREE.MeshLambertMaterial({ color: 0x8B5A2B }); // 木色
	const leafMat = makeMaterial(loadTexture("./images/moss_block.png"));	
	 
	const treeScale = {x: XZ_SCALE * 0.5, y: 0.5, z: XZ_SCALE * 0.5};
	
	const woodMesh = makeHillInstanced(woodCubes, woodMaterial, treeScale);
	const leafMesh = makeHillInstanced(leafCubes, leafMat, treeScale); 
 
	scene.add(woodMesh, leafMesh); 

	// 8. ===== 靜態方塊雲 - 擺幾個就得 =====
	const cloudGeo = new THREE.BoxGeometry(1.2, 0.8, 1.2); // 薄啲
	const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
	function makeCloud(cx, cy, cz, w, d) {
		// w,d = 闊深，例如 8x6 就係8粒x6粒大
		const maxBlocks = w * d * 3;
		const mesh = new THREE.InstancedMesh(cloudGeo, cloudMat, maxBlocks);
		const dummy = new THREE.Object3D();
		let idx = 0;
		// 中心點，用距離做圓形/橢圓形雲，唔係方形
		for (let x = -w/2; x < w/2; x++) {
			for (let z = -d/2; z < d/2; z++) {
				const dist = (x*x)/(w*w/4) + (z*z)/(d*d/4); // 橢圓距離
				if (dist > 1) continue; // 出界唔畫，變圓雲
				if (dist > 0.6 && Math.random() < 0.5) continue; // 邊緣隨機缺口，唔同形狀
				const layers = dist < 0.3 ? 3 : (dist < 0.7 ? 2 : 1); // 中間厚3層，邊緣1層
				for (let y = 0; y < layers; y++) {
					dummy.position.set(
					  cx + x * 1.1, // 1.1少少重疊，睇落一嚿過
					  cy + y * 0.8,
					  cz + z * 1.1
					);
					dummy.scale.set(1, 1, 1);
					dummy.updateMatrix();
					mesh.setMatrixAt(idx++, dummy.matrix);
				}
			}
		}
		mesh.count = idx;
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		return mesh;
	}
	// 5朵全部唔同大細，但全部最多3層，一嚿過
	const cloudList = [
		makeCloud(0, 40, -20, 10, 7),   // 大扁雲
		makeCloud(40, 35, 10, 7, 7),    // 細厚雲 3層
		makeCloud(-50, 45, 30, 15, 5),  // 長條雲
		makeCloud(20, 30, 0, 6, 6),   // 細圓雲
		makeCloud(-30, 35, -40, 10, 9), // 中型不規則
	];
	cloudList.forEach(c => scene.add(c)); 	 
 
	 
	// ===== 9. 渲染 =====
	const timer = new THREE.Timer();

    let frameCount = 0;
	function animateOcean(d, el) {
		// delta 係同幀率無關嘅時間，唔會因為電腦卡就快慢唔同
		frameCount++;
		if (frameCount % 3 !== 0) return; // 每3秒更新一次，唔洗每幀都計
		
		shallowMat.map.offset.x += d * 0.02;
		shallowMat.map.offset.y += d * 0.01;
		//surfaceMesh.position.y = -0.75 + Math.sin(elp * 0.8) * 0.05; 
	}
	
	function animate() {
		if (document.hidden) {
            setTimeout(animate,330); // 當頁面唔見，降幀率
		}

		requestAnimationFrame(animate);
		
		timer.update(); // Timer 必須要 update!
 
		const delta = timer.getDelta();
		const elapsed = timer.getElapsed();
		
		animateOcean(delta, elapsed);

		controls.update();
		renderer.render(scene, camera);
	}
	
	animate();
}        
 
load();
 
window.addEventListener('resize', ()=>{
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
})
