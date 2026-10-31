import * as THREE from './scripts/three.module.js';
import { OrbitControls } from './scripts/OrbitControls.js';

// ===== 1. 你原本的 Mercator 公式，完全保留 =====
/**************************************************
 * Config
 **************************************************/
const GEOJSON_URL = "/hk_coast.json";
const MOUNT_URL = "/hk_mount.json";

const CELL_M = 250; 
const OCEAN_SIZE = 2000; // 無限大，用10000格=3000km，遠超可視範圍

const LAND_HEIGHT = 2;
const COAST_HEIGHT = 1.5; 
const WATER_HEIGHT = 1;

//For standard Web Mercator
const R = 6378137; 
const CENTER_LON = 114.1398;
const CENTER_LAT = 22.3837;

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

function lonLatToWorld(lon, lat){    
	 
	const lonRad = THREE.MathUtils.degToRad(lon);
    const latRad = THREE.MathUtils.degToRad(lat);
	
    const x = R * lonRad;
    const y = R * Math.log(Math.tan(Math.PI/4 + latRad/2)); 
	
    return {x, y};
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
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({antialias:true});
	
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
	scene.fog = new THREE.FogExp2(0x87CEEB, 0.0012); 

	// 修正視角：整個香港 210x154格，剛好置中
	// 相機拉高拉遠，俯視 45度，最適合睇全島
	camera.position.set(0, 180, 180);
	camera.lookAt(0, 0, 0);

	renderer.setSize(innerWidth, innerHeight);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;//
	renderer.setClearColor(scene.fog.color); 

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
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.target.set(0, 0, 0);
	controls.minDistance = 50;
	controls.maxDistance = 1000;
	controls.maxPolarAngle = Math.PI / 2.05;
	controls.minPolarAngle = 0;
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
	
	const COLS = Math.ceil(widthM / CELL_M);
	const ROWS = Math.ceil(heightM / CELL_M);

	console.log(`香港 ${COLS}x${ROWS} 格`)
	 
	function lonLatToGrid(lon, lat){
		const w = lonLatToWorld(lon, lat); 
		return {
			gridX: Math.floor((w.x - origin.x) / CELL_M),
			gridZ: Math.floor((w.y - origin.y) / CELL_M),
			worldX: (w.x - origin.x) / CELL_M,
			worldZ: (w.y - origin.y) / CELL_M // // Minecraft的Z是向南为正，墨卡托Y向北为正，所以要反一下
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
	  const mat = new THREE.MeshStandardMaterial({
		map: createWaterTexture(32, color),
		color: 0xffffff,
		roughness: opts.roughness ?? 0.8,
		metalness: opts.metalness ?? 0.1,
		transparent: opts.transparent ?? true,
		opacity: opts.opacity ?? 1,
		fog: true,
		depthWrite: opts.depthWrite ?? false,
	  });
	  mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;

	  const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE),
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
	  roughness: 1,
	  metalness: 0,
	  transparent: false,
	  depthWrite: true,
	  opacity: 1,
	  renderOrder: 0
	});

	// 2. 上層：淺水表層 - 半透明
	const { mesh: surfaceMesh, mat: shallowMat } = createOceanLayer('#2A7FBE', -0.75, {
	  roughness: 0.8,
	  metalness: 0.1,
	  transparent: true,
	  opacity: 0.5,
	  depthWrite: false,
	  renderOrder: 1
	});

	scene.add(deepMesh, surfaceMesh);
 
	///////////////////////////////////////////////////////////////////////////////////
	 
	// 相機視角改為睇香港本身，唔係海洋
	const oceanW = COLS;
	const oceanH = ROWS;

	fitCameraToGrid(COLS * 2, ROWS * 2) // 睇大啲，見到無限海  

	// ===== 5.1 生成整個香港陸地，綠色 Box (優化版) =====
	const landCells = [];
	const seen = new Set();

	// 1. 預先計算每個 polygon 的 bbox，轉做格子範圍，唔使掃全地圖
	const polyBounds = allPolys.map(poly=>{
		let pMinLon=180, pMaxLon=-180, pMinLat=90, pMaxLat=-90;
		for(const [lon,lat] of poly){
			pMinLon=Math.min(pMinLon,lon); 
			pMaxLon=Math.max(pMaxLon,lon);
			pMinLat=Math.min(pMinLat,lat); 
			pMaxLat=Math.max(pMaxLat,lat);
		}
		// bbox 轉格子範圍，夾到 ROWS/COLS 入面
		const c0 = Math.max(0, Math.floor((pMinLon - minLon)/(maxLon-minLon)*COLS));
		const c1 = Math.min(COLS-1, Math.ceil((pMaxLon - minLon)/(maxLon-minLon)*COLS));
		const r0 = Math.max(0, Math.floor((pMinLat - minLat)/(maxLat-minLat)*ROWS));
		const r1 = Math.min(ROWS-1, Math.ceil((pMaxLat - minLat)/(maxLat-minLat)*ROWS));
		return {poly, c0, c1, r0, r1};
	})

	// 2. 反向遍歷：對每個 poly，只掃佢 bbox 入面嘅格子
	for(const {poly, c0, c1, r0, r1} of polyBounds){
		for(let r=r0; r<=r1; r++){
			const lat = minLat + (r+0.5)/ROWS*(maxLat-minLat);
			for(let c=c0; c<=c1; c++){
				const key = `${c},${r}`;
				if(seen.has(key)) continue;
				const lon = minLon + (c+0.5)/COLS*(maxLon-minLon);
				if(pointInPolygon(lon, lat, poly)){
					landCells.push({x:c, z:r});
					seen.add(key);
				}
			}
		}
	} 

	// 如果想再快10倍，直接用預計算好嘅 300m 格子，唔使即時計：
	// const pre = await fetch('./hk_300m_grid.json').then(r=>r.json())
	// const landCells = pre.cells.map(c=>({x:c.grid_x, z:c.grid_z})) 

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
	fitCameraToGrid(COLS, ROWS);

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
	const BEACH_SURFACE_Y = 1; // 沙灘 Box 0.35高，位置-0.12，頂部 0.055

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

	const stoneTopText = loadTexture(
			"./images/stone.png"
		);	 
		
	const stoneMats = makeMaterial(stoneTopText);
		
	const mountMaterials = stoneMats;
	
	const terraGeo = new THREE.BoxGeometry(1, 1, 1);
	const count = mountGeo.features.length;
	const terraMesh = new THREE.InstancedMesh(terraGeo, mountMaterials, count);

	mountGeo.features.forEach((f, i) => {
		const [lon, lat] = f.geometry.coordinates;
		const { elevation, name } = f.properties;
		const grid = lonLatToGrid(lon, lat);
		const mh = Math.round(elevation / CELL_M); 
  
		const boxH = mh; 
		const worldX = grid.worldX - centerX - 1;
		const worldY = LAND_SURFACE_Y + boxH / 2; // 底部貼地
		const worldZ = centerZ - grid.worldZ + 2;

		dummy.position.set(worldX, worldY, worldZ);
		dummy.scale.set(1.5, boxH, 1.5);
		dummy.updateMatrix();

		terraMesh.setMatrixAt(i, dummy.matrix);

		// 山頂加 3格高處放名
		const label = makeTextSprite(name, elevation);
		label.position.set(worldX, LAND_SURFACE_Y + mh + 3, worldZ); // offser
		scene.add(label) 
	});
	
	terraMesh.instanceMatrix.needsUpdate = true;	
	scene.add(terraMesh); 

	const stoneMaterials = [
		"rock_block1.png",
		"rock_block2.png", 
		"rock_block3.png"
	].map(f => makeMaterial(loadTexture(`./images/${f}`)));
		 
	// === 2. 預算每個材質要多少方塊 ===
	const BLOCK_H = 2/3, BLOCK_W = 1, MAX_MH = 5;
	const mountainsData = mountGeo.features.map(f => {
	  let mh = Math.min(MAX_MH, Math.max(1, Math.round(f.properties.elevation / CELL_M)));
	  return { f, mh, baseW: mh*2 };
	});

	const counts = new Array(stoneMaterials.length).fill(0);
	const assignments = []; // 存每個方塊要用哪個材質
	mountainsData.forEach(({mh, baseW}) => {
	  for(let y=0;y<mh;y++){
		const size = Math.ceil(baseW * (1 - y/mh));
		for(let x=0;x<size;x++){
		  for(let z=0;z<size;z++){
			if(Math.random()<0.2 && (x===0||z===0||x===size-1||z===size-1)) continue; // 不規則邊緣
			const matIdx = Math.floor(Math.random()*stoneMaterials.length);
			assignments.push(matIdx);
			counts[matIdx]++;
		  }
		}
	  }
	});

	// === 3. 為每種貼圖建一個 InstancedMesh ===
	const unitGeo = new THREE.BoxGeometry(1,1,1);
	const meshes = stoneMaterials.map((mat, i) => {
	  const m = new THREE.InstancedMesh(unitGeo, mat, counts[i]);
	  m.castShadow = m.receiveShadow = true;
	  return m;
	});
	const cursors = new Array(stoneMaterials.length).fill(0);
	 
	// === 4. 堆金字塔 ===
	let globalIdx = 0;
	mountainsData.forEach(({f, mh, baseW}) => {
	  const [lon, lat] = f.geometry.coordinates;
	  const grid = lonLatToGrid(lon, lat);
	  const cx = grid.worldX - centerX - 1;
	  const cz = centerZ - grid.worldZ + 2;

	  for(let y=0;y<mh;y++){
		const size = Math.ceil(baseW * (1 - y/mh));
		const yPos = LAND_SURFACE_Y + y*BLOCK_H + BLOCK_H/2;
		const offset = size*BLOCK_W/2 - BLOCK_W/2;

		for(let x=0;x<size;x++){
		  for(let z=0;z<size;z++){
			const matIdx = assignments[globalIdx++];
			if(matIdx === undefined) continue; // 被不規則跳過的
			// 上面不規則判斷要和預算時一致，這裡簡化重算一次
			if(Math.random()<0.2 && (x===0||z===0||x===size-1||z===size-1)) {
			   globalIdx--; continue; 
			}

			dummy.position.set(cx + x*BLOCK_W - offset, yPos, cz + z*BLOCK_W - offset);
			dummy.scale.set(BLOCK_W, BLOCK_H, BLOCK_W);
			dummy.rotation.set(0,0,0);
			dummy.updateMatrix();
			
			const mesh = meshes[matIdx];
			mesh.setMatrixAt(cursors[matIdx]++, dummy.matrix);
		  }
		}
	  }
	});

	meshes.forEach(m => {
	  m.instanceMatrix.needsUpdate = true;
	  scene.add(m);
	}); 

	// 8. ===== 靜態方塊雲 - 擺幾個就得 =====
	function createStaticCloud(x, z, scale = 1) {
		const group = new THREE.Group();

		const mat = new THREE.MeshStandardMaterial({
			color: 0xffffff,
			flatShading: true,
			roughness: 1,
			metalness: 0,
			fog: true // 等遠嘅雲有霧化，唔會太實
		});

		const boxGeo = new THREE.BoxGeometry(12, 2, 12);

		// 手砌一個Minecraft雲形，唔用random，咁先靚
		const positions = [
			[0,0,0], [12,0,0], [-12,0,0], [0,0,12], [0,0,-12],
			[12,0,12], [-12,0,12], [12,0,-12], [-12,0,-12],
			[0,2,0], [2,2,2] // 頂部加兩嚿
		];

		positions.forEach(p => {
			const mesh = new THREE.Mesh(boxGeo, mat);
			mesh.position.set(p[0], p[1], p[2]);
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			group.add(mesh);
		});

		group.position.set(x, 20, z); // Y=120 固定高度
		group.scale.set(scale, scale, scale);
		return group;
	}

	// 擺5嚿喺你個世界唔同方位
	const cloudGroup = new THREE.Group();

	cloudGroup.add(createStaticCloud(250, 60, 1.2));
	cloudGroup.add(createStaticCloud(-250, -150, 1));
	cloudGroup.add(createStaticCloud(0, -120, 1.5)); // 正前面大大嚿
	cloudGroup.add(createStaticCloud(-200, 170, 0.9));
	cloudGroup.add(createStaticCloud(150, -80, 1));

	scene.add(cloudGroup); 
	
	// ===== 9. 渲染 =====
	// ===== 9. 渲染 =====
	const timer = new THREE.Timer();
	
	function animateOcean(d, elp) {
		// delta 係同幀率無關嘅時間，唔會因為電腦卡就快慢唔同
		shallowMat.map.offset.x += d * 0.008;
		shallowMat.map.offset.y += d * 0.005;
		surfaceMesh.position.y = -0.75 + Math.sin(elp * 0.8) * 0.05;
	}
	
	function animate(){
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
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
})
