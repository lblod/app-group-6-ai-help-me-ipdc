(in-package :mu-cl-resources)

(setf *include-count-in-paginated-responses* t)
(setf *supply-cache-headers-p* t)
(setf sparql:*experimental-no-application-graph-for-sudo-select-queries* t)
(setf *cache-model-properties-p* t)
(setf mu-support::*use-custom-boolean-type-p* nil)
(setq *cache-count-queries-p* t)
(setf sparql:*query-log-types* nil) ;; hint: use app-http-logger for logging queries instead, all is '(:default :update-group :update :query :ask)


;; example
;; (define-resource dataset ()
;;   :class (s-prefix "dcat:Dataset")
;;   :properties `((:title :string ,(s-prefix "dct:title"))
;;                 (:description :string ,(s-prefix "dct:description")))
;;   :has-one `((catalog :via ,(s-prefix "dcat:dataset")
;;                       :inverse t
;;                       :as "catalog"))
;;   :has-many `((theme :via ,(s-prefix "dcat:theme")
;;                      :as "themes"))
;;   :resource-base (s-url "http://webcat.tmp.semte.ch/datasets/")
;;   :on-path "datasets")


(define-resource public-service ()
		:class (s-prefix "ipdc-lpdc:InstancePublicServiceSnapshot")
		:properties `((:title :string ,(s-prefix "terms:title"))
									(:description :string, (s-prefix "terms:description")))
		:has-many `((requirement :via ,(s-prefix "publicservice:hasRequirement")
                           :as "requirements")
	             (procedure :via ,(s-prefix "cpsv:follows")
                           :as "procedures"))
		:on-path "public-services")

(define-resource requirement ()
		:class (s-prefix "m8g:Requirement")
		:properties `((:title :string ,(s-prefix "terms:title"))
									(:description :string, (s-prefix "terms:description"))
									(:order :number, (s-prefix "shacl:order")))
		:on-path "requirements")

(define-resource procedure ()
		:class (s-prefix "cpsv:Rule")
		:properties `((:title :string ,(s-prefix "terms:title"))
									(:description :string, (s-prefix "terms:description"))
									(:order :number, (s-prefix "shacl:order")))
		:on-path "procedures")

;; reading in the domain.json
(read-domain-file "domain.json")
