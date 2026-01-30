const express = require('express');
const router = express.Router();

// Sample data
let doctors = [
    { id: 1, name: 'د. محمد أحمد', clinic: 'عيادة النور', phone: '01012345678' },
    { id: 2, name: 'د. فاطمة حسن', clinic: 'عيادة الشفاء', phone: '01098765432' },
];

// GET all doctors
router.get('/', (req, res) => {
    res.json({ success: true, data: doctors });
});

// GET single doctor
router.get('/:id', (req, res) => {
    const doctor = doctors.find(d => d.id === parseInt(req.params.id));
    if (!doctor) {
        return res.status(404).json({ success: false, error: 'Doctor not found' });
    }
    res.json({ success: true, data: doctor });
});

// POST create doctor
router.post('/', (req, res) => {
    const newDoctor = {
        id: doctors.length + 1,
        ...req.body
    };
    doctors.push(newDoctor);
    res.status(201).json({ success: true, data: newDoctor });
});

// PUT update doctor
router.put('/:id', (req, res) => {
    const index = doctors.findIndex(d => d.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Doctor not found' });
    }
    doctors[index] = { ...doctors[index], ...req.body };
    res.json({ success: true, data: doctors[index] });
});

// DELETE doctor
router.delete('/:id', (req, res) => {
    const index = doctors.findIndex(d => d.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Doctor not found' });
    }
    const deleted = doctors.splice(index, 1);
    res.json({ success: true, data: deleted[0] });
});

module.exports = router;
