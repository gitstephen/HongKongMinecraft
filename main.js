import * as THREE from "three";
import { OrbitControls } from "OrbitControls";
  
////////////////////////////////////////////////////////////
// 基本設定
////////////////////////////////////////////////////////////
 
const GEOJSON_FILE =
    "/hk_coast.json";

const MAP_SIZE = 150;

const BLOCK_SIZE = 100;

const SEA_SIZE =
    MAP_SIZE *
    BLOCK_SIZE *
    1.5;

const SHALLOW_LEVEL =
    BLOCK_SIZE * 0.25;

const COAST_LEVEL =
    BLOCK_SIZE;

const LAND_LEVEL =
    BLOCK_SIZE * 2;

////////////////////////////////////////////////////////
// SCENE
////////////////////////////////////////////////////////

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x87ceeb);

////////////////////////////////////////////////////////
// CAMERA
////////////////////////////////////////////////////////

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    1000000
);

camera.position.set(
    120000,
    70000,
    120000
);

////////////////////////////////////////////////////////
// RENDERER
////////////////////////////////////////////////////////

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

////////////////////////////////////////////////////////
// CONTROLS
////////////////////////////////////////////////////////

const controls =
new OrbitControls(
    camera,
    renderer.domElement
);

controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0,0,0);

////////////////////////////////////////////////////////
// LIGHT
////////////////////////////////////////////////////////

scene.add(new THREE.AmbientLight(0xffffff,1.6));

const sun = new THREE.DirectionalLight(
    0xffffff,
    2
);

sun.position.set(
    100000,
    120000,
    80000
);

scene.add(sun);

////////////////////////////////////////////////////////
// DEEP OCEAN
////////////////////////////////////////////////////////

const sea = new THREE.Mesh(

    new THREE.BoxGeometry(
        SEA_SIZE,
        BLOCK_SIZE,
        SEA_SIZE
    ),

    new THREE.MeshPhongMaterial({

        color:0x084398,

        transparent:true,

        opacity:0.95

    })

);

sea.position.y = -BLOCK_SIZE / 2;

scene.add(sea);

////////////////////////////////////////////////////////
// POINT IN POLYGON
////////////////////////////////////////////////////////

function pointInPolygon(point, polygon){

    let inside = false;

    for(
        let i=0,
        j=polygon.length-1;
        i<polygon.length;
        j=i++
    ){

        const xi = polygon[i][0];
        const yi = polygon[i][1];

        const xj = polygon[j][0];
        const yj = polygon[j][1];

        const intersect =

        ((yi > point[1]) !==
        (yj > point[1]))

        &&

        (
            point[0]

            <

            ((xj-xi)
            *
            (point[1]-yi))
            /
            (yj-yi)

            + xi
        );

        if(intersect)
            inside=!inside;
    }

    return inside;
}

////////////////////////////////////////////////////////
// LOAD GEOJSON
////////////////////////////////////////////////////////

const geojson = await fetch(GEOJSON_FILE).then(r=>r.json());

const polygons = [];

geojson.features.forEach(feature=>{

    const g = feature.geometry;

    if(g.type==="Polygon"){

        polygons.push(
            g.coordinates[0]
        );
    }

    else if(g.type==="MultiPolygon"){

        g.coordinates.forEach(poly=>{

            polygons.push(
                poly[0]
            );

        });

    }

});

////////////////////////////////////////////////////////
// BOUNDS
////////////////////////////////////////////////////////

let minLon = Infinity;
let maxLon = -Infinity;

let minLat = Infinity;
let maxLat = -Infinity;

for(const poly of polygons){

    for(const p of poly){

        minLon =
        Math.min(minLon,p[0]);

        maxLon =
        Math.max(maxLon,p[0]);

        minLat =
        Math.min(minLat,p[1]);

        maxLat =
        Math.max(maxLat,p[1]);

    }

}

////////////////////////////////////////////////////////
// RASTERIZE
////////////////////////////////////////////////////////

const blocks = [];
const landMap = new Set();

for(let gx=0; gx<MAP_SIZE; gx++){

    for(let gz=0; gz<MAP_SIZE; gz++){

        const lon =

            minLon +

            (gx / MAP_SIZE)

            *

            (maxLon - minLon);

        const lat =

            maxLat -

            (gz / MAP_SIZE)

            *

            (maxLat - minLat);

        let isLand = false;

        for(const poly of polygons){

            if(
                pointInPolygon(
                    [lon,lat],
                    poly
                )
            ){
                isLand = true;
                break;
            }
        }

        if(isLand){

            blocks.push({
                x:gx,
                z:gz
            });

            landMap.add(
                `${gx},${gz}`
            );

        }

    }

}

////////////////////////////////////////////////////////
// COAST DETECTION (2 BLOCKS)
////////////////////////////////////////////////////////

function isCoast(x,z){

    for(let dx=-2; dx<=2; dx++){

        for(let dz=-2; dz<=2; dz++){

            if(dx===0 && dz===0)
                continue;

            const dist =
                Math.abs(dx)
                +
                Math.abs(dz);

            if(dist > 2)
                continue;

            if(
                !landMap.has(
                    `${x+dx},${z+dz}`
                )
            ){
                return true;
            }

        }

    }

    return false;

}

////////////////////////////////////////////////////////
// CLASSIFY
////////////////////////////////////////////////////////

const coastBlocks = [];
const grassBlocks = [];

blocks.forEach(b=>{

    if(
        isCoast(
            b.x,
            b.z
        )
    ){
        coastBlocks.push(b);
    }
    else{
        grassBlocks.push(b);
    }

});

////////////////////////////////////////////////////////
// SHALLOW WATER
////////////////////////////////////////////////////////

const shallowBlocks = [];
const shallowMap = new Set();

coastBlocks.forEach(block=>{

    const dirs = [

        [1,0],
        [-1,0],

        [0,1],
        [0,-1],

        [1,1],
        [-1,1],

        [1,-1],
        [-1,-1]

    ];

    dirs.forEach(([dx,dz])=>{

        const x = block.x + dx;
        const z = block.z + dz;

        const key =
        `${x},${z}`;

        if(landMap.has(key))
            return;

        if(shallowMap.has(key))
            return;

        shallowMap.add(key);

        shallowBlocks.push({
            x,
            z
        });

    });

});

////////////////////////////////////////////////////////
// GEOMETRY
////////////////////////////////////////////////////////

const blockGeometry =
new THREE.BoxGeometry(
    BLOCK_SIZE,
    BLOCK_SIZE,
    BLOCK_SIZE
);

const shallowGeometry =
new THREE.BoxGeometry(
    BLOCK_SIZE,
    BLOCK_SIZE * 0.5,
    BLOCK_SIZE
);

////////////////////////////////////////////////////////
// MATERIAL
////////////////////////////////////////////////////////

const grassMaterial = [

    new THREE.MeshLambertMaterial({
        color:0x6D4C41
    }),

    new THREE.MeshLambertMaterial({
        color:0x6D4C41
    }),

    new THREE.MeshLambertMaterial({
        color:0x4CAF50
    }),

    new THREE.MeshLambertMaterial({
        color:0x6D4C41
    }),

    new THREE.MeshLambertMaterial({
        color:0x6D4C41
    }),

    new THREE.MeshLambertMaterial({
        color:0x6D4C41
    })

];

const coastMaterial =
new THREE.MeshLambertMaterial({
    color:0xFFE082
});

const shallowMaterial =
new THREE.MeshLambertMaterial({
    color:0x116BB5
});

////////////////////////////////////////////////////////
// MESH
////////////////////////////////////////////////////////

const grassMesh =
new THREE.InstancedMesh(
    blockGeometry,
    grassMaterial,
    grassBlocks.length
);

const coastMesh =
new THREE.InstancedMesh(
    blockGeometry,
    coastMaterial,
    coastBlocks.length
);

const shallowMesh =
new THREE.InstancedMesh(
    shallowGeometry,
    shallowMaterial,
    shallowBlocks.length
);

////////////////////////////////////////////////////////
// BUILD
////////////////////////////////////////////////////////

const matrix =
new THREE.Matrix4();

const offsetX =
MAP_SIZE / 2;

const offsetZ =
MAP_SIZE / 2;

shallowBlocks.forEach((b,i)=>{

    matrix.makeTranslation(

        (b.x-offsetX)
        *
        BLOCK_SIZE,

        SHALLOW_LEVEL,

        (b.z-offsetZ)
        *
        BLOCK_SIZE

    );

    shallowMesh.setMatrixAt(
        i,
        matrix
    );

});

coastBlocks.forEach((b,i)=>{

    matrix.makeTranslation(

        (b.x-offsetX)
        *
        BLOCK_SIZE,

        COAST_LEVEL,

        (b.z-offsetZ)
        *
        BLOCK_SIZE

    );

    coastMesh.setMatrixAt(
        i,
        matrix
    );

});

grassBlocks.forEach((b,i)=>{

    matrix.makeTranslation(

        (b.x-offsetX)
        *
        BLOCK_SIZE,

        LAND_LEVEL,

        (b.z-offsetZ)
        *
        BLOCK_SIZE

    );

    grassMesh.setMatrixAt(
        i,
        matrix
    );

});

scene.add(shallowMesh);
scene.add(coastMesh);
scene.add(grassMesh);

////////////////////////////////////////////////////////
// RESIZE
////////////////////////////////////////////////////////

window.addEventListener(
    "resize",
    ()=>{

        camera.aspect =
        window.innerWidth /
        window.innerHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
            window.innerWidth,
            window.innerHeight
        );

    }
);

////////////////////////////////////////////////////////
// RENDER LOOP
////////////////////////////////////////////////////////

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