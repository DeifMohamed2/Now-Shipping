// Language change route
router.get('/change-language/:lang', (req, res) => {
    const { lang } = req.params;
    res.cookie('lang', lang);
    res.redirect('back');
}); 