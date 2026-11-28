import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { getSignedUrl, type CaseAttachment } from '../../lib/storage';
import type { DoctorPortalText } from '../../translations/doctorPortal';

export default function DoctorModelPreview({ file, close, text }: { file: CaseAttachment; close: () => void; text: DoctorPortalText }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const host = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [fileUrl, setFileUrl] = useState<string | null>(null);

    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    useEffect(() => {
        const container = host.current;
        if (!container) return;
        const request = new AbortController();
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#f1f5f9');
        const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
        let renderer: THREE.WebGLRenderer | undefined;
        let controls: OrbitControls | undefined;
        let geometry: THREE.BufferGeometry | undefined;
        let material: THREE.Material | undefined;
        let observer: ResizeObserver | undefined;

        async function load() {
            if (!container) return;
            const url = await getSignedUrl(file.storagePath, 120, file.storageBucket);
            if (!url) throw new Error('File access unavailable');
            if (request.signal.aborted) return;
            setFileUrl(url);
            const response = await fetch(url, { signal: request.signal });
            if (!response.ok) throw new Error('File could not be read');
            const bytes = await response.arrayBuffer();
            if (request.signal.aborted) return;
            if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('File is too large');

            const isPly = /\.ply$/i.test(file.storagePath);
            geometry = isPly ? new PLYLoader().parse(bytes) : new STLLoader().parse(bytes);
            const positions = geometry.getAttribute('position');
            if (!positions?.count) throw new Error('Empty geometry');
            geometry.computeBoundingSphere();
            const bounds = geometry.boundingSphere;
            if (!bounds || !Number.isFinite(bounds.radius) || bounds.radius <= 0) throw new Error('Invalid geometry');
            geometry.translate(-bounds.center.x, -bounds.center.y, -bounds.center.z);
            geometry.scale(1 / bounds.radius, 1 / bounds.radius, 1 / bounds.radius);

            if (isPly && !geometry.index) {
                material = new THREE.PointsMaterial({ color: '#087e8b', size: 0.025, vertexColors: geometry.hasAttribute('color') });
                scene.add(new THREE.Points(geometry, material));
            } else {
                if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
                material = new THREE.MeshStandardMaterial({ color: '#52aab4', side: THREE.DoubleSide, vertexColors: geometry.hasAttribute('color') });
                scene.add(new THREE.Mesh(geometry, material));
            }
            scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
            const key = new THREE.DirectionalLight(0xffffff, 2);
            key.position.set(3, 4, 5);
            scene.add(key);

            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.domElement.setAttribute('aria-label', text.scanPreviewTitle);
            container.replaceChildren(renderer.domElement);
            camera.position.set(2.2, 1.5, 2.7);
            controls = new OrbitControls(camera, renderer.domElement);
            controls.minDistance = 1.3;
            controls.maxDistance = 9;
            const render = () => renderer?.render(scene, camera);
            controls.addEventListener('change', render);
            observer = new ResizeObserver(() => {
                if (!renderer || !container.clientWidth || !container.clientHeight) return;
                camera.aspect = container.clientWidth / container.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(container.clientWidth, container.clientHeight);
                render();
            });
            observer.observe(container);
            setState('ready');
        }

        void load().catch(() => { if (!request.signal.aborted) setState('error'); });
        return () => {
            request.abort();
            observer?.disconnect();
            controls?.dispose();
            geometry?.dispose();
            material?.dispose();
            renderer?.dispose();
            renderer?.domElement.remove();
        };
    }, [file.storageBucket, file.storagePath, text.scanPreviewTitle]);

    return (
        <dialog ref={dialog} aria-labelledby="doctor-model-title" onCancel={close} className="doctor-portal m-auto w-[min(92vw,48rem)] rounded-2xl bg-white p-4 text-slate-900 shadow-xl backdrop:bg-slate-900/60 dark:bg-slate-900 dark:text-slate-100">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="doctor-model-title" className="text-base font-bold">{text.scanPreviewTitle}</h2>
                <button type="button" onClick={close} className="portal-chip">{text.closeScanPreview}</button>
            </div>
            <div ref={host} className="h-[min(58vh,30rem)] min-h-44 w-full overflow-hidden rounded-xl bg-slate-100" />
            {state === 'loading' && <p role="status" className="portal-muted mt-2">{text.loadingScan}</p>}
            {state === 'ready' && <p className="portal-muted mt-2">{text.scanPreviewControls}</p>}
            {state === 'error' && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{text.scanPreviewError}</p>}
            {fileUrl && <a className="portal-chip mt-3" href={fileUrl} target="_blank" rel="noopener noreferrer">{text.openOriginalScan}</a>}
        </dialog>
    );
}
