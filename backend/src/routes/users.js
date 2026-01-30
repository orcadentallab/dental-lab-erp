const express = require('express');
const router = express.Router();

// Sample data
let users = [
    { id: 1, username: 'admin', role: 'admin', name: 'مدير النظام' },
    { id: 2, username: 'designer1', role: 'designer', name: 'مصمم 1' },
];

// GET all users
router.get('/', (req, res) => {
    res.json({ success: true, data: users });
});

// GET single user
router.get('/:id', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, data: user });
});

// POST create user
router.post('/', (req, res) => {
    const newUser = {
        id: users.length + 1,
        ...req.body
    };
    users.push(newUser);
    res.status(201).json({ success: true, data: newUser });
});

// PUT update user
router.put('/:id', (req, res) => {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    users[index] = { ...users[index], ...req.body };
    res.json({ success: true, data: users[index] });
});

// DELETE user
router.delete('/:id', (req, res) => {
    const index = users.findIndex(u => u.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    const deleted = users.splice(index, 1);
    res.json({ success: true, data: deleted[0] });
});

module.exports = router;
