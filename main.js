import * as THREE from './scripts/three.module.js';
import { OrbitControls } from './scripts/OrbitControls.js';

// ===== 1. 你原本的 Mercator 公式，完全保留 =====
/**************************************************
 * Config
 **************************************************/
const GEOJSON_URL = "/hk_coast.json";
const MOUNT_URL = "/hk_mount.json";

const CELL_M = 300; 
const OCEAN_SIZE = 2000; // 無限大，用10000格=3000km，遠超可視範圍

const LAND_HEIGHT = 3;
const COAST_HEIGHT = 1.5; 
const WATER_HEIGHT = 1;

const R = 6378137;

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
	OCEAN: '#0A2F6B'
};

const MATERIALS = {
    LAND_OPACITY: 1.0,
    SHALLOW_OPACITY: 0.75,
    OCEAN_OPACITY: 0.85
};

function lonLatToWorld(lon, lat){
    const x = R * THREE.MathUtils.degToRad(lon);
    const y = R * Math.log(
        Math.tan(
            Math.PI/4 +
            THREE.MathUtils.degToRad(lat)/2
        )
    );
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

const makeMaterial = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0, flatShading: true });
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

	const renderer = new THREE.WebGLRenderer({antialias:true});
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

	console.log(`香港 ${widthM/1000}km x ${heightM/1000}km = ${COLS}x${ROWS}格`)

	function lonLatToGrid(lon, lat){
		const p = lonLatToWorld(lon, lat);
		return {
			gridX: Math.floor((p.x - origin.x) / CELL_M),
			gridZ: Math.floor((p.y - origin.y) / CELL_M),
			worldX: (p.x - origin.x) / CELL_M,
			worldZ: (p.y - origin.y) / CELL_M
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
	const deepMat = new THREE.MeshStandardMaterial({
		map: createWaterTexture(32, COLORS.OCEAN), // 深藍
		color: 0xffffff,
		roughness: 1.0,
		metalness: 0,
		fog: true,
		transparent: false // 底層完全唔透，當作海底色
	}); 
	const deepMesh = new THREE.Mesh(
		new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE),
		deepMat
	);
	deepMesh.rotation.x = -Math.PI / 2;
	deepMesh.position.set(0, -1.5, 0); // 比上層低 0.7格
	deepMesh.receiveShadow = false;
	scene.add(deepMesh);

	// --- 2. 上層：淺水表層 (半透明，有波紋) ---
	const shallowMat = new THREE.MeshStandardMaterial({
		map: createWaterTexture(32, '#2A7FBE'), // 淺藍
		color: 0xffffff,
		roughness: 0.8,
		metalness: 0.1,
		transparent: true,
		fog: true,
		opacity: 0.3, // 關鍵：半透明先見到下面深色
		depthWrite: false // 關鍵：兩層透明先唔會打交閃爍
	});
	const surfaceMesh = new THREE.Mesh(
		new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE),
		shallowMat
	);
	surfaceMesh.rotation.x = -Math.PI / 2;
	surfaceMesh.position.set(0, -0.75, 0); // 高過深海
	surfaceMesh.receiveShadow = false;

	// 令上層一定畫喺下層上面
	surfaceMesh.renderOrder = 1;
	deepMesh.renderOrder = 0;
	scene.add(surfaceMesh);
	// 想要個海有少少郁動，做深淺閃爍

	/* function animateOcean() {
		const time = Date.now() * 0.0003;
		// 上層慢慢移，做水流
		shallowMat.map.offset.x = time * 0.5;
		shallowMat.map.offset.y = time * 0.2;
	} */

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
	console.log(`陸地格子: ${landCells.length} (優化後，只檢查 bbox 內)`)

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

	console.log(`原本 ${originalLandSet.size} -> 內陸 ${innerLandSet.size} + 沙灘 ${beachSet.size}`)

	// 內陸 - 綠色 Box
	const landGeo = new THREE.BoxGeometry(1, LAND_HEIGHT, 1);
	//LAND
	const landTopText = loadTexture(
			"./images/grass_top.png"
		);	

	const landSideText = loadTexture(
			"./images/grass_block.png"
		);	
		
	const landBottomText = loadTexture(
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

	const landMesh = new THREE.InstancedMesh(landGeo, landMaterials, innerLandSet.size);
	landMesh.castShadow = true;
	landMesh.receiveShadow = true; 
	 
	const centerX = COLS/2, centerZ = ROWS/2;
	fitCameraToGrid(COLS, ROWS);

	let li=0;
	for(const k of innerLandSet){
		const [x,z] = k.split(',').map(Number);
		dummy.position.set(x - centerX, 0, -(z - centerZ));
		dummy.updateMatrix();
		landMesh.setMatrixAt(li++, dummy.matrix);
	}
	scene.add(landMesh);

	// 沙灘 - 沙色 Box
	const beachGeo = new THREE.BoxGeometry(1, COAST_HEIGHT, 1); 
	const sandTopTexture = loadTexture(
			"./images/sand_top.png"
		);	

	const sandSideTexture = loadTexture(
			"./images/sand_side.png"
		); 
		
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

	const beachMesh = new THREE.InstancedMesh(beachGeo, beachMaterials, beachSet.size);
	beachMesh.receiveShadow = false;

	let bi=0;
	for(const k of beachSet){
		const [x,z] = k.split(',').map(Number);
		dummy.position.set(x - centerX, -0.5, -(z - centerZ)); // 比陸地矮少少
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
		
	const waterMaterials = [
		//+X 右面 right
		makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY),
		//-X 左面 left
		makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY),
		//+Y 上面 top
		makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY),
		// -Y 下面 bottom
		makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY),
		//+Z 前面 front
		makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY),
		//-Z 後面 back
		makeAlphaMaterial(waterTopText, MATERIALS.SHALLOW_OPACITY)   
	];	
	const beachwMesh = new THREE.InstancedMesh(shallowGeo, waterMaterials, shallowSet.size);

	let si=0;
	for(const k of shallowSet){
		const [x,z] = k.split(',').map(Number);
		dummy.position.set(x-centerX, -0.85, -(z-centerZ));
		dummy.updateMatrix();
		beachwMesh.setMatrixAt(si++, dummy.matrix);
	}
	scene.add(beachwMesh);

	// ===== 7. 高山 - 用原本 mount.json，比例喺代碼計 =====  
	const stoneTopText = loadTexture(
			"./images/stone.png"
		);	 
		
	const mountMaterials = [
		//+X 右面 right
		makeMaterial(stoneTopText),
		//-X 左面 left
		makeMaterial(stoneTopText),
		//+Y 上面 top
		makeMaterial(stoneTopText),
		// -Y 下面 bottom
		makeMaterial(stoneTopText),
		//+Z 前面 front
		makeMaterial(stoneTopText),
		//-Z 後面 back
		makeMaterial(stoneTopText)
	];

	const LAND_SURFACE_Y = LAND_HEIGHT / 2;  // 綠色陸地 Box 0.6高，頂部 0.3
	const BEACH_SURFACE_Y = 1; // 沙灘 Box 0.35高，位置-0.12，頂部 0.055

	function makeTextSprite(text, elevation){
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		const fontSize = 56;
		ctx.font = `bold ${fontSize}px 'Noto Sans HK', sans-serif`;
		const label = `${text}  ${elevation}m`;
		const metrics = ctx.measureText(label);
		const paddingX = 32;
		const paddingY = 16;
		const radius = 18;
		canvas.width = metrics.width + paddingX*2;
		canvas.height = 80;
		ctx.clearRect(0,0,canvas.width,canvas.height);
		
		// 黑色背景，有啲透明 + 圓角
		ctx.fillStyle = 'rgba(0,0,0,0.55)';
		ctx.beginPath();
		ctx.roundRect(0, 0, canvas.width, canvas.height, radius);
		ctx.fill();
		
		// 美化文字
		ctx.font = `bold ${fontSize}px 'Noto Sans HK', sans-serif`;
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#FFFFFF';
		ctx.shadowColor = 'rgba(0,0,0,0.5)';
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 1;
		ctx.fillText(label, paddingX, canvas.height/2);
		
		const tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		
		const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
		const sprite = new THREE.Sprite(mat);
		sprite.scale.set(canvas.width/28, canvas.height/28, 1);
		sprite.renderOrder = 999;
	  
		return sprite;
	} 

	for(const f of mountGeo.features){
		const [lon, lat] = f.geometry.coordinates; // 原本經緯度保留
		const { elevation, name } = f.properties; // 原本屬性保留
		
		const grid = lonLatToGrid(lon, lat);
		const h = Math.round(elevation / CELL_M) * 1.5; // 比例喺代碼計：957m / 300 = 3.19格
	  
	 
		console.log(`山: ${name}, 高度: ${elevation}`);
		// 用 BoxGeometry 定位
		// 判斷山腳係內陸定沙灘
		const key = `${Math.floor(grid.gridX)},${Math.floor(grid.gridZ)}`;
		const surfaceY = beachSet.has(key) ? BEACH_SURFACE_Y : LAND_SURFACE_Y;
		// 底部貼實表面
		const geo = new THREE.BoxGeometry(0.8, h, 0.8);
		
		const mesh = new THREE.Mesh(geo, mountMaterials);
		mesh.position.set(grid.worldX - centerX , LAND_SURFACE_Y + h/2, -(grid.worldZ - centerZ));
		mesh.name = name;
		mesh.castShadow = true;

		scene.add(mesh);
		
		// 山頂加 1.2格高處放名
		const label = makeTextSprite(name, elevation);
		label.position.set(grid.worldX - centerX, LAND_SURFACE_Y + h + 2, -(grid.worldZ - centerZ));
		scene.add(label)
	}

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

	function updateInfiniteOcean() {
		// 等塊海嘅中心永遠喺你腳下，但Y唔跟，唔係你飛起塊海都飛起
		surfaceMesh.position.x = camera.position.x;
		surfaceMesh.position.z = camera.position.z;
		deepMesh.position.x = camera.position.x;
		deepMesh.position.z = camera.position.z;
	} 
	
	// ===== 9. 渲染 =====
	function animate(){
		requestAnimationFrame(animate);
		//updateInfiniteOcean();
		
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


 