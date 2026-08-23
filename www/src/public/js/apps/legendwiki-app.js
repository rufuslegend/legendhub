var app = angular.module( "legendwiki-app", ['ngCookies'] );

/* Gets a parameter by name from the url's query string
 *
 * @param {string} name - The name of the query parameter.
 */
function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ?
        '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
};

app
    .factory("unauthorizedInterceptor", unauthorizedInterceptor)
    .config(httpProviderConfig);

unauthorizedInterceptor.$inject = ["$q"];

// http interceptor to redirect all 401/403 responses to the 401 page
function unauthorizedInterceptor($q) {
	return {
		responseError(response) {
			if (response.status === 401 || response.status === 403) {
				window.location = '/error/401.html';
			}

			return $q.reject(response);
		}
	};
}

httpProviderConfig.$inject = ["$httpProvider"];

function httpProviderConfig($httpProvider) {
    $httpProvider.interceptors.push("unauthorizedInterceptor");
};

app.constant('itemConstants', {
	slots: ["Light",
	"Finger",
	"Neck",
	"Body",
	"Head",
	"Face",
	"Legs",
	"Feet",
	"Hands",
	"Arms",
	"Shield",
	"About",
	"Waist",
	"Wrist",
	"Wield",
	"Hold",
	"Ear",
	"Arm",
	"Amulet",
	"Aux",
	"Familiar",
	"Other"],
	aligns: [
        "No Align Restriction",
		"Good Only Align",
		"Neutral Only Align",
		"Evil Only Align",
		"Non-Good Align",
        "Non-Neutral Align",
		"Non-Evil Align"],
	shortAligns: [
        "     ",
		"G    ",
		"  N  ",
		"    E",
		"  N E",
		"G   E",
		"G N  "],
  selectOptions: {
    slot: [
      "Light",
	    "Finger",
	    "Neck",
	    "Body",
	    "Head",
	    "Face",
	    "Legs",
	    "Feet",
	    "Hands",
	    "Arms",
	    "Shield",
	    "About",
	    "Waist",
	    "Wrist",
	    "Wield",
	    "Hold",
	    "Ear",
	    "Arm",
	    "Amulet",
	    "Aux",
	    "Familiar",
	    "Other"
    ],
    alignRestriction: [
      "No Align Restriction",
      "Good Only Align",
      "Neutral Only Align",
      "Evil Only Align",
      "Non-Good Align",
      "Non-Neutral Align",
      "Non-Evil Align"
    ],
    weaponType: [
      "",
      "Bladed Weapon",
      "Piercing Weapon",
      "Blunt Weapon"
    ],
    weaponStat: [
      "",
      "Strength",
      "Dexterity",
      "Constitution"
    ]
  },
  selectShortOptions: {
    slot: [
        "Light",
        "Finger",
	    "Neck",
	    "Body",
	    "Head",
	    "Face",
	    "Legs",
	    "Feet",
	    "Hands",
	    "Arms",
	    "Shield",
	    "About",
	    "Waist",
	    "Wrist",
	    "Wield",
	    "Hold",
	    "Ear",
	    "Arm",
	    "Amulet",
	    "Aux",
	    "Familiar",
	    "Other"
    ],
    alignRestriction: [
      "     ",
      "G    ",
      "  N  ",
      "    E",
      "  N E",
      "G   E",
      "G N  "
    ],
    weaponType: [
      "",
      "Bladed",
      "Piercing",
      "Blunt"
    ],
    weaponStat: [
      "",
      "Str",
      "Dex",
      "Con"
    ]
  }
});

app.factory("breadcrumb", breadcrumbFactory);

function breadcrumbFactory() {
	function Breadcrumb() {
		this.links = [];
	}

	return new Breadcrumb();
};

app.factory("categories", categoriesFactory);

function categoriesFactory() {
	function Categories() {
		this.categories = [];
		this.subcategories = [];
		this.categoryNameProperty = "Name";
		this.subcategoryNameProperty = "Name";
		this.subcategoryCategoryProperty = "CategoryId";
		this.defaultId = -1;
		this.clearSelectedCategories();
	}

	/** @description Sets the options for the category service.
	 * @param {string} categoryNameProperty The name of the property that holds the category name.
	 * @param {string} subcategoryNameProperty The name of the property that holds the subcategory name.
	 * @param {string} subcategoryCategoryProperty The name of the property that holds the related categoryId for the subcategory.
	*/
	Categories.prototype.setOptions = function(categoryNameProperty, subcategoryNameProperty, subcategoryCategoryProperty, defaultId) {
		this.categoryNameProperty = categoryNameProperty;
		this.subcategoryNameProperty = subcategoryNameProperty;
		this.subcategoryCategoryProperty = subcategoryCategoryProperty;
		this.defaultId = defaultId;
	}

	/** @description Gets the category name via the given identifier.
	 * @param {number} id The identifier.
	 * @return {string} The category name.
	 */
	Categories.prototype.getCategoryName = function(id) {
		for (var i = 0; i < this.categories.length; ++i) {
			if (this.categories[i].Id == id) {
				return this.categories[i][this.categoryNameProperty];
			}
		}
		return '';
	}

	/** @description Gets the subcategory name via the given identifier.
	 * @param {number} id The identifier.
	 * @return {string} The subcategory name.
	*/
	Categories.prototype.getSubcategoryName = function(id) {
		for (var i = 0; i < this.subcategories.length; ++i) {
			if (this.subcategories[i].Id == id) {
				return this.subcategories[i][this.subcategoryNameProperty];
			}
		}
		return '';
	}

	/** @description Sets the categories for the service.
	 * @param {array} categories
	 */
	Categories.prototype.setCategories = function(categories) {
		this.categories = categories;
	}

	/** @description Sets the categories for the service.
	 * @param {array} subcategories
	 */
	Categories.prototype.setSubcategories = function(subcategories) {
		this.subcategories = subcategories;
	}

	/** @description Sets the current category.
	 * @param {number} id The Id of the category.
	 */
	Categories.prototype.setSelectedCategory = function(id) {
		if (id) {
			this.categoryId = id;
		}
	}

	/** @description Sets the current subcategory.
	 * @param {number} id The Id of the subcategory.
	 */
	Categories.prototype.setSelectedSubcategory = function(id) {
		if (id) {
			this.subcategoryId = id;
		}
	}

	/** @description Returns whether or not the selected category Id is valid.
	 * @returns {boolean}
	 */
	Categories.prototype.hasSelectedCategory = function() {
		return this.categoryId > this.defaultId;
	}

	/** @description Returns whether or not the selected subcategory Id is valid.
	 * @returns {boolean}
	 */
	Categories.prototype.hasSelectedSubcategory = function() {
		return this.subcategoryId > this.defaultId;
	}

	/** @description Gets the current category Id.
	 * @returns {number}
	 */
	Categories.prototype.getCategoryId = function() {
		return this.categoryId;
	}

	/** @description Gets the current subcategory Id.
	 * @returns {number}
	 */
	Categories.prototype.getSubcategoryId = function() {
		return this.subcategoryId;
	}

	/** @description Gets the current category name.
	 * @returns {number}
	 */
	Categories.prototype.getSelectedCategoryName = function() {
		return this.getCategoryName(this.categoryId);
	}

	/** @description Gets the current subcategory name.
	 * @returns {number}
	 */
	Categories.prototype.getSelectedSubcategoryName = function() {
		return this.getSubcategoryName(this.subcategoryId);
	}

	/** @description Gets the selected subcategory if selected, otherwise will get the selected category if selected. Used for displaying the category we're searching on.
	 * @returns {string}
	*/
	Categories.prototype.getActiveCategory = function() {
		if (this.categoryId && this.categoryId > this.defaultId) {
			if (this.subcategoryId && this.subcategoryId > this.defaultId) {
				return this.getSubcategoryName(this.subcategoryId);
			}
			return this.getCategoryName(this.categoryId);
		}
		return '';
	}

	/** @description Gets the subcategories that are under the selected category.
	 * @returns {array}
	 */
	Categories.prototype.getFilteredSubcategories = function() {
		if (this.categoryId) {
			var filtered = [];
			for (var i = 0; i < this.subcategories.length; ++i) {
				if (this.subcategories[i][this.subcategoryCategoryProperty] == this.categoryId) {
					filtered.push(this.subcategories[i]);
				}
			}
			return filtered;
		}

		return [];
	}

	/** @description Clears the selected categories. */
	Categories.prototype.clearSelectedCategories = function() {
		this.categoryId = this.defaultId;
		this.subcategoryId = this.defaultId;
	}

	return new Categories();
};

app.directive("lhAutofocus", autofocusDirective);

autofocusDirective.$inject = ["$timeout"];

function autofocusDirective($timeout) {
	return {
		restrict: 'A',
		link : function($scope, $element) {
			$timeout(function() {
				$element[0].focus();
			});
		}
	}
};

app.directive('lhTooltip', tooltipDirective);

function tooltipDirective() {
	return {
		restrict: 'A',
		link: function(scope, element, attrs) {
			element.on('mouseenter', function() {
				element.tooltip({html: true});
				element.tooltip('show');
			});
			element.on('mouseleave', function() {
				element.tooltip('hide');
			});
		}
	};
};

app.factory("encoder", encoderFactory);

function encoderFactory() {
	var rixits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

	return {
		fromNumber : function(number, minLength) {
			if (isNaN(Number(number))
                || number === null
			    || number === Number.POSITIVE_INFINITY
			    || number === Number.NEGATIVE_INFINITY)
				  number = 0;
			var negative = number < 0;
			number = Math.abs(number);

			var rixit;
			var residual = Math.floor(number);
			var result = '';
			while (true) {
				rixit = residual % rixits.length;
				result = rixits.charAt(rixit) + result;
				residual = Math.floor(residual / rixits.length);

				if (residual == 0)
					break;
			}
			while (minLength != null && result.length < minLength)
				result = '0' + result;
			if (negative)
				result = '-' + result;
			return result;
		},
		toNumber : function(r) {
			var result = 0;
			r = r.split('');
			var negative = r[0] == '-';
			if (negative)
				r.shift();

			for (var e = 0; e < r.length; e++)
				result = (result * rixits.length) + rixits.indexOf(r[e]);

			if (negative)
				return result * -1;

			return result;
		}
	}
};

function exceptionService($log) {
    var service = {};
    service.callbacks = [];

    function addCallback(cb) {
        service.callbacks.push(cb);
    }

    function logException(exception, cause) {
        for (var i = 0; i < service.callbacks.length; ++i) {
            service.callbacks[i](exception, cause);
        }

        $log.error(exception, cause);
    }

    service.addCallback = addCallback;
    service.logException = logException;

    return service;
};

app.factory("exceptionService", ["$log", exceptionService]);

function exceptionHandler(exceptionService) {
    return function myHandler(exception, cause) {
        exceptionService.logException(exception, cause);
    }
}

app.factory("$exceptionHandler", ["exceptionService", exceptionHandler]);
