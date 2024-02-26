const axios = require('axios');
const {DateTime} = require('luxon');
const fs = require('fs').promises;
const querystring = require('querystring');
const Openai = require('openai');
require('dotenv').config();

const openai = new Openai({
    apiKey: process.env.OPENAI_API_KEY,
});

const days = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

/**
 * @typedef {Object} MenuResponseDayMenu
 * @property {string} type
 * @property {string} menu - A description of the meal.
 * @property {string} friendlyUrl
 * @property {string} image
 */

/**
 * @typedef {Object} MenuResponseDay
 * @property {string} dayOfWeek
 * @property {string} date
 * @property {MenuResponseDayMenu[]} menus - This will usually contain a single entry, which is the meal of the day.
 */

/**
 * @typedef {Object} MenuResponse
 * @property {number} weekNumber
 * @property {string} firstDateOfWeek
 * @property {MenuResponseDay[]} days
 */

async function fetchFoodData() {
    /**
     * @type {Array.<{day: string, date: string, foodName: string, foodContents: undefined|string[], image: undefined|string}>}
     */
    let menuItems = [];
    
    try {
        const rawJson = await fs.readFile('../site/data/menu.json', {encoding: 'utf-8'});
        menuItems = JSON.parse(rawJson);
    } catch (e) {
        console.error(e);
    }

    axios.default.get('https://www.shop.foodandco.dk/api/WeeklyMenu', {
        params: {
            restaurantId: 1089,
            languageCode: 'da-DK',
        },
    }).then(res => {
        /**
         * @type {MenuResponse}
         */
        const data = res.data;

        for (const dayIdx in data.days) {
            const day = data.days[dayIdx];
            /**
             * @type {MenuResponseDayMenu}
             */
            const menu = day.menus[0] ?? {
                type: 'Dagens varme ret',
                menu: 'Ingenting',
                friendlyUrl: '/gf/undefined',
                image: 'https://images.foodandco.dk/Cache/7000/26db3d14e906a285ea7351e22a11617c.jpg',
            };

            const idx = menuItems.findIndex(it => it.date === day.date);
            if (idx > -1) {
                menuItems[idx] = {
                    day: days[dayIdx],
                    date: day.date,
                    foodName: menu.menu,
                    foodContents: menuItems[idx].foodContents,
                    image: menuItems[idx].image,
                }
            } else {
                menuItems.push({
                    day: days[dayIdx],
                    date: day.date,
                    foodName: menu.menu,
                    foodContents: undefined,
                    image: undefined,
                });
            }
        }

        // noinspection JSAnnotator
        let nextMonday = DateTime.fromISO(data.firstDateOfWeek).plus({days: 7});
        axios.default.get('https://www.shop.foodandco.dk/api/WeeklyMenu', {
            params: {
                restaurantId: 1089,
                languageCode: 'da-DK',
                date: `${nextMonday.toFormat('yyyy-MM-dd')}`,
            },
        }).then(async res => {
            const data = res.data;

            for (const dayIdx in data.days) {
                const day = data.days[dayIdx];
                /**
                 * @type {MenuResponseDayMenu}
                 */
                const menu = day.menus[0] ?? {
                    type: 'Dagens varme ret',
                    menu: 'Ingenting',
                    friendlyUrl: '/gf/undefined',
                    image: 'https://images.foodandco.dk/Cache/7000/26db3d14e906a285ea7351e22a11617c.jpg',
                };

                const idx = menuItems.findIndex(it => it.date === day.date);
                if (idx > -1) {
                    menuItems[idx] = {
                        day: days[dayIdx],
                        date: day.date,
                        foodName: menu.menu,
                        foodContents: menuItems[idx].foodContents,
                        image: menuItems[idx].image,
                    }
                } else {
                    menuItems.push({
                        day: days[dayIdx],
                        date: day.date,
                        foodName: menu.menu,
                        foodContents: undefined,
                        image: undefined,
                    });
                }
            }

            try {
                await fs.mkdir('../site/data', {recursive: true});
            } catch (e) {
                console.error(e);
            }
            await fs.writeFile('../site/data/menu.json', JSON.stringify(menuItems, null, 4)).then(() => console.log('done'));
            await fs.writeFile('../site/data/menu.js', `var menu = ${JSON.stringify(menuItems)}`).then(() => console.log('done'));
            console.log(menuItems);
            await checkFoodContents(['fisk', 'svinekød', 'kød', 'kylling']);
            await generateImages();
        });

    }).catch(console.error);
}

fetchFoodData();
setInterval(fetchFoodData, 21600000);

/**
 *
 * @param {string[]} foodTypes
 * @returns {Promise<void>}
 */
async function checkFoodContents(foodTypes) {
    /**
     * @type {Array.<{day: string, date: string, foodName: string, foodContents: undefined|string[]}>}
     */
    let menuItems = [];
    try {
        const rawJson = await fs.readFile('../site/data/menu.json', {encoding: 'utf-8'});
        menuItems = JSON.parse(rawJson);
    } catch (e) {
        console.error(e);
    }

    for (const menuItem of menuItems.filter(it => it.foodContents === undefined)) {
        menuItem.foodContents = [];
        for (const foodType of foodTypes) {
            const completion = await openai.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: `Din opgave er at afgøre om der er ${foodType} i denne ret. Hvis den indeholder ${foodType} skal du svare med "ja" og ikke andet. Hvis ikke den indeholder ${foodType} skal du svare med "nej" og ikke andet.`,
                    },
                    {
                        role: 'user',
                        content: `Retten hedder "${menuItem.foodName}"`,
                    },
                ],
                model: 'gpt-4-0613',
            });

            const response = completion.choices[0].message.content.toLowerCase();

            if (response === 'ja') {
                menuItem.foodContents.push(foodType);
            }

            console.log(`Checking if "${menuItem.foodName}" contains "${foodType}". Response: "${response}"`);
        }
    }

    await fs.writeFile('../site/data/menu.json', JSON.stringify(menuItems, null, 4)).then(() => console.log('done'));
    await fs.writeFile('../site/data/menu.js', `var menu = ${JSON.stringify(menuItems)}`).then(() => console.log('done'));
    console.log(menuItems);
}

async function generateImages() {
    /**
     * @type {Array.<{day: string, date: string, foodName: string, foodContents: undefined|string[]}>}
     */
    let menuItems = [];
    try {
        const rawJson = await fs.readFile('../site/data/menu.json', {encoding: 'utf-8'});
        menuItems = JSON.parse(rawJson);
    } catch (e) {
        console.error(e);
    }

    for (const menuItem of menuItems.filter(it => it.image === undefined)) {
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: `Food called "${menuItem.foodName}"`,
            n: 1,
            size: "1024x1024",
            quality: 'hd',
          });
          console.log(response.data);
          menuItem.image = response.data[0].url;

          console.log(`Generated image for "${menuItem.foodName}" at "${menuItem.image}".`);
    }

    await fs.writeFile('../site/data/menu.json', JSON.stringify(menuItems, null, 4)).then(() => console.log('done'));
    await fs.writeFile('../site/data/menu.js', `var menu = ${JSON.stringify(menuItems)}`).then(() => console.log('done'));
    console.log(menuItems);
}

async function getNetatmo() {
    try {
        try {
            await fs.mkdir('./secret', {recursive: true});
        } catch (e) {
            console.error(e);
        }
        let netatmoCredentials = JSON.parse(await fs.readFile('./secret/netatmoCreddentials.json', {encoding: 'utf-8'}));

        const current_time = Date.now();

        if (netatmoCredentials.expires_at === undefined || current_time > netatmoCredentials.expires_at) {
            console.log('Refreshing netatmo...');

            const tokenResponse = await axios.post('https://api.netatmo.com/oauth2/token', querystring.stringify({
                grant_type: 'refresh_token',
                refresh_token: netatmoCredentials.refresh_token,
                client_id: process.env.NETATMO_CLIENT_ID,
                client_secret: process.env.NETATMO_CLIENT_SECRET,
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });

            netatmoCredentials = tokenResponse.data;

            netatmoCredentials.expires_at = Date.now() + (tokenResponse.data.expires_in * 1000);

            console.log(netatmoCredentials);

            await fs.writeFile('./secret/netatmoCreddentials.json', JSON.stringify(tokenResponse.data, null, 4));
        }

        const timestamp = getTimestampInSeconds() - 2700;
        const measureResponse = await axios.get(`https://api.netatmo.com/api/getmeasure?device_id=70:ee:50:83:f5:34&scale=30min&type=sum_rain&module_id=05:00:00:0a:b3:90&optimize=true&date_begin=${timestamp}`, {
            headers: {
                'Authorization': `Bearer ${netatmoCredentials.access_token}`,
            },
        });

        const rainValue = measureResponse.data.body[0]?.value[0][0];
        console.log('rainValue', rainValue);

        try {
            await fs.mkdir('../site/data', {recursive: true});
        } catch (e) {
            console.error(e);
        }
        fs.writeFile('../site/data/rain.json', JSON.stringify({rainValue: rainValue ?? 0})).then(() => console.log('rain done'));
    } catch (error) {
        console.log(error);
    }
}

getNetatmo();
setInterval(getNetatmo, 300000);

function getTimestampInSeconds() {
    return Math.floor(Date.now() / 1000);
}
