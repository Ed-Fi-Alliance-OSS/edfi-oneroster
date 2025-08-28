drop index if exists oneroster12.users_sourcedid;
drop materialized view if exists oneroster12.users;
--
create materialized view if not exists oneroster12.users as
with student as (
    select * from edfi.student
),
student_school as (
    select * from edfi.studentSchoolAssociation
),
school as (
    select * from edfi.school
),
staff as (
    select * from edfi.staff
),
staff_school as (
    select * from edfi.staffschoolassociation
),
staff_edorg_assign as (
    select * from edfi.staffeducationorganizationassignmentassociation
),
student_ids as (
    select 
        seoa_sid.studentusi,
        seoa_sid.educationOrganizationId,
        json_agg(json_build_object(
            'type', studentIDsystemDescriptor.codeValue,
            'identifier', identificationcode
        )) as ids
    from edfi.studentEducationOrganizationAssociationStudentIdentifica_c15030 seoa_sid
		join edfi.descriptor studentIDsystemDescriptor
            on seoa_sid.studentIdentificationSystemDescriptorId=studentIDsystemDescriptor.descriptorId
    group by 1,2
),
student_email as (
	select x.*
	from (
		select 
	        seoa_et.*,
	        emailtypedescriptor.codevalue = 'Home/Personal' as is_preferred,
	        row_number() over( 
	        	partition by studentusi 
	        	order by (emailtypedescriptor.codevalue = 'Home/Personal') desc nulls last, emailtypedescriptor.codevalue
        	) as seq
	    from edfi.studenteducationorganizationassociationelectronicmail as seoa_et
			join edfi.descriptor emailtypedescriptor
	            on seoa_et.electronicMailTypeDescriptorId=emailtypedescriptor.descriptorid
  	) x
    where seq = 1 and (donotpublishindicator is null or not donotpublishindicator)
),
student_orgs as (
    select 
        studentusi,
        school.localEducationAgencyId,
        school.schoolId,
        md5(school.schoolId::text) as sourcedid,
        student_school.primarySchool,
        student_school.entryDate
    from student_school
    join school 
        on student_school.schoolId = school.schoolId
),
student_orgs_agg as (
    select 
        studentusi,
        json_agg(
			json_build_object(
	            'roleType', case
	            	when primaryschool or schoolId=(
				        	-- most-recent school:
		            		select schoolId
				        	from student_orgs x
				        	where student_orgs.studentusi=x.studentusi
				        	order by entrydate desc
				        	limit 1
				    	) then 'primary'
	            	else 'secondary'
            	end,
	            'role', 'student',
	            'org', json_build_object(
	                'href', concat('/orgs/', sourcedid::text),
	                'sourcedId', sourcedid,
	                'type', 'org'
	            )
	    	)
    	) AS "roles",
        json_agg(
			json_build_object(
	            'roleType', case
	            	when primaryschool or schoolId=(
				        	-- most-recent school:
		            		select schoolId
				        	from student_orgs x
				        	where student_orgs.studentusi=x.studentusi
				        	order by entrydate desc
				        	limit 1
				    	) then 'primary'
	            	else 'secondary'
            	end,
	            'role', 'parent',
	            'org', json_build_object(
	                'href', concat('/orgs/', sourcedid::text),
	                'sourcedId', sourcedid,
	                'type', 'org'
	            )
	    	)
    	) AS "parentRoles"
    from student_orgs
    group by 1
),
student_keys as (
    select 
        studentusi,
    	studentuniqueid,
        md5(concat('STU-', studentUniqueId::text)) as sourced_id, -- unique ID constructed from natural key of Ed-Fi Students
        studentUniqueId::text as natural_key
    from student
),
student_grade as (
    select x.*
	from (
        select 
            studentusi,
            schoolyear,
            gradeleveldescriptor.codevalue as grade_level,
            row_number() over(
                partition by studentusi, schoolyear
                order by 
                    -- latest entry date
                    entrydate desc,
                    -- tie break on longer
                    exitwithdrawdate desc nulls first,
                    -- tie break on grade level reverse alpha
                    gradeleveldescriptor.codevalue desc
            ) as seq
        from student_school
            join edfi.descriptor gradeleveldescriptor
                on student_school.entrygradeleveldescriptorid=gradeleveldescriptor.descriptorid
    ) x
    where seq = 1
),
formatted_users_student as (
    select 
        student_keys.sourced_id as "sourcedId",
        'active' as "status",
        student.lastmodifieddate as "dateLastModified",
        null::text as "userMasterIdentifier",
        case when student_email.electronicmailaddress is null then '' else student_email.electronicmailaddress end as "username",
        case when student_ids.ids is not null then
            jsonb_insert(
                student_ids.ids::jsonb,
                '{0}',
                json_build_object(
                    'type', 'studentUniqueId',
                    'identifier', student.studentUniqueId
                )::jsonb
            )::json
        else
            json_build_array(json_build_object(
                'type', 'studentUniqueId',
                'identifier', student.studentUniqueId
            ))
        end as "userIds",
        'true' as "enabledUser", 
        student.firstname as "givenName",
        student.lastsurname as "familyName",
        student.middlename as "middleName",
        student.preferredfirstname as "preferredFirstName",
        null::text as "preferredMiddleName",
        student.preferredlastsurname as "preferredLastName",
        null::text as "pronouns",
        'student' as "role",
        student_orgs_agg.roles AS "roles",
        null as "userProfiles",
        student.studentuniqueid as "identifier",
        student_email.electronicmailaddress as "email",
        null::text as "sms",
        null::text as "phone",
        null::text as "agentSourceIds",
        json_build_array(student_grade.grade_level) as "grades", -- TODO: xwalk to OR grade levels?
        null::text as "password",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'students',
                'naturalKey', json_build_object(
                    'studentUniqueId', student.studentuniqueid
                )
            )
        ) AS metadata
    from student
    join student_keys 
        on student.studentusi = student_keys.studentusi
    join student_grade 
        on student.studentusi = student_grade.studentusi
    left join student_orgs_agg
        on student.studentusi = student_orgs_agg.studentusi
    left join student_ids
        on student.studentusi = student_ids.studentusi
    left join student_email
        on student.studentusi = student_email.studentusi
    --left join grade_level_xwalk 
    --    on student.grade_level = grade_level_xwalk.edfi_grade_level
),
-- find staff who teach sections this year, regardless of classification
teaching_staff as (
    select distinct staffusi  
    from edfi.staffsectionassociation
),
lea_staff_classification as (
    select
        staff_school.*,
        mappedstaffclassificationdescriptor.mappedvalue as lea_staff_classification
    from staff_school
    	join school
    		on staff_school.schoolid = school.schoolid
        left join edfi.localeducationagency
            on school.localeducationagencyid=localeducationagency.localeducationagencyid
        left join staff_edorg_assign
            on staff_school.staffusi = staff_edorg_assign.staffusi
            and localeducationagency.localeducationagencyid  = staff_edorg_assign.educationorganizationid
        left join edfi.descriptor staffclassificationdescriptor
            on staff_edorg_assign.staffclassificationdescriptorid=staffclassificationdescriptor.descriptorid
        left join edfi.descriptormapping mappedstaffclassificationdescriptor
            on mappedstaffclassificationdescriptor.value=staffclassificationdescriptor.codevalue
                and mappedstaffclassificationdescriptor.namespace=staffclassificationdescriptor.namespace
                and mappedstaffclassificationdescriptor.mappednamespace='uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
    where localeducationagency.localeducationagencyid is not null
        and staffclassificationdescriptor.codeValue is not null
),
staff_school_with_classification as (
    select
        staff_school.*,
        coalesce(mappedschoolstaffclassificationdescriptor.mappedvalue, 
                 mappedleastaffclassificationdescriptor.mappedvalue) as staff_classification
    from staff_school
        join school
            on staff_school.schoolid=school.schoolid
        left join staff_edorg_assign school_assign
            on staff_school.staffusi = school_assign.staffusi
            and staff_school.schoolid = school_assign.educationorganizationid
        left join staff_edorg_assign lea_assign
            on staff_school.staffusi = lea_assign.staffusi
            and school.localeducationagencyid = lea_assign.educationorganizationid
        left join edfi.descriptor schoolstaffclassificationdescriptor
            on school_assign.staffclassificationdescriptorid=schoolstaffclassificationdescriptor.descriptorid
        left join edfi.descriptormapping mappedschoolstaffclassificationdescriptor
            on mappedschoolstaffclassificationdescriptor.value=schoolstaffclassificationdescriptor.codevalue
                and mappedschoolstaffclassificationdescriptor.namespace=schoolstaffclassificationdescriptor.namespace
                and mappedschoolstaffclassificationdescriptor.mappednamespace='uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
        left join edfi.descriptor leastaffclassificationdescriptor
            on lea_assign.staffclassificationdescriptorid=leastaffclassificationdescriptor.descriptorid
        left join edfi.descriptormapping mappedleastaffclassificationdescriptor
            on mappedleastaffclassificationdescriptor.value=leastaffclassificationdescriptor.codevalue
                and mappedleastaffclassificationdescriptor.namespace=leastaffclassificationdescriptor.namespace
                and mappedleastaffclassificationdescriptor.mappednamespace='uri://1edtech.org/oneroster12/StaffClassificationDescriptor'
    where school.schoolid is not null
),
staff_role as (
    select x.*
	from (
        select 
            staff_school.staffusi,
            coalesce(staff_school.staff_classification, 'teacher') as staff_classification,
            row_number() over(partition by staff_school.staffusi order by staff_classification) as seq
        from staff_school_with_classification as staff_school
        left join teaching_staff 
            on staff_school.staffusi = teaching_staff.staffusi
        -- either has a staff_classification, or teaches a section
        where (staff_school.staff_classification is not null or teaching_staff.staffusi is not null)
    ) x
    -- only one role per staff. if multiple, prefer admin over teacher
    where seq = 1
),
staff_ids as (
    select 
        staffusi,
        json_agg(json_build_object(
            'type', staffIDsystemDescriptor.codeValue,
            'identifier', identificationcode
        )) as ids
    from edfi.staffidentificationcode
		join edfi.descriptor staffIDsystemDescriptor
            on staffidentificationcode.staffIdentificationSystemDescriptorId=staffIDsystemDescriptor.descriptorId
    group by 1
),
-- splitting this into two models to support customizable org guids
staff_orgs as (
    select 
        staffusi,
        schoolid,
        staff_classification,
        createdate
    from staff_school_with_classification
),
staff_orgs_agg as (
    select 
        staffusi,
        json_agg(
			json_build_object(
	            'roleType', case
	            	when schoolId=(
				        	-- most-recent school:
		            		select schoolId
				        	from staff_orgs x
				        	where staff_orgs.staffusi=x.staffusi
				        	order by createdate desc
				        	limit 1
				    	) then 'primary'
	            	else 'secondary'
            	end,
	            'role', staff_classification,
	            'org', json_build_object(
	                'href', concat('/orgs/', md5(schoolid::text)),
	                'sourcedId', md5(schoolid::text),
	                'type', 'org'
	            )
	    	)
    	) AS "roles"
    from staff_orgs
    group by 1
),
staff_email as (
    select
        staffusi,
        null::int as educationorganizationid,
        donotpublishindicator,
        electronicMailTypeDescriptor.codeValue as email_type,
        electronicmailaddress as email_address
    from edfi.staffelectronicmail
		join edfi.descriptor electronicMailTypeDescriptor
            on staffelectronicmail.electronicMailTypeDescriptorId=electronicMailTypeDescriptor.descriptorId
),
staff_edorg_email as (
    select
        seoca.staffusi,
        seoca.educationorganizationid,
        null::boolean as donotpublishindicator,
        seoca.contacttitle as email_type,
        seoca.electronicmailaddress as email_address
    from edfi.staffeducationorganizationcontactassociation as seoca
        -- use staffs join to filter to the last observed school_year for a given staff contact record
        join staff
            on seoca.staffusi = staff.staffusi
),
stacked_emails as (
    select * from staff_email
    union all
    select * from staff_edorg_email
),
staff_emails as (
    select
        *,
        -- allow dots, hyphens, and underscores in email (and optionally plus-addressing)
        -- but don't allow apostrophes, spaces, other characters
        -- allow final URL component to be between 2 and 9 characters
        email_address ~ '^[a-zA-Z0-9_.-]+[+]?[a-zA-Z0-9.-]*@[a-zA-Z0-9.-]+[.][a-zA-Z0-9]{2,9}$' as is_valid_email
    from stacked_emails
),
choose_email as (
    select x.*
	from (
		select 
	        *,
	        email_type = 'Work' as is_preferred,
	        row_number() over( 
	        	partition by staffusi 
	        	order by (email_type = 'Work') desc nulls last, email_type
        	) as seq
	    from staff_emails
  	) x
    where seq = 1 and (donotpublishindicator is null or not donotpublishindicator)
),
formatted_users_staff as (
    select 
        md5(concat('STA-', staffUniqueId::text)) as "sourcedId", 
        'active' as "status",
        lastmodifieddate as "dateLastModified",
        null::text as "userMasterIdentifier",
        case when choose_email.email_address is null then '' else choose_email.email_address end as "username",
        jsonb_insert(
        	staff_ids.ids::jsonb,
        	'{0}',
        	json_build_object(
            	'type', 'staffUniqueId',
            	'identifier', staff.staffUniqueId
            )::jsonb
        )::json as "userIds",
        'true' as "enabledUser",
        staff.firstname as "givenName",
        staff.lastsurname as "familyName",
        staff.middlename as "middleName",
        staff.preferredfirstname as "preferredFirstName",
        null::text as "preferredMiddleName",
        staff.preferredlastsurname as "preferredLastName",
        null::text as "pronouns",
        staff_role.staff_classification as "role",
        staff_orgs_agg.roles AS "roles",
        null::text as "userProfiles",
        staff.staffUniqueId as "identifier",
        choose_email.email_address as "email",
        null::text as "sms",
        null::text as "phone",
        null::text as "agentSourceIds",
        null::json as "grades",
        null::text as "password",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'staffs',
                'naturalKey', json_build_object(
                    'staffUniqueId', staffUniqueId
                ),
                'staffClassification', staff_role.staff_classification
            )
        ) AS metadata
    from staff
        join staff_ids 
            on staff.staffusi = staff_ids.staffusi
        join staff_role
            on staff.staffusi = staff_role.staffusi
        left join staff_orgs_agg 
            on staff.staffusi = staff_orgs_agg.staffusi
        left join choose_email
            on staff.staffusi = choose_email.staffusi
),
parent_emails as (
    select contactusi, electronicmailaddress, electronicmailtypedescriptorid
    from edfi.contactelectronicmail
    where primaryemailaddressindicator and not donotpublishindicator
),
formatted_users_parents as (
    select 
        md5(concat('PAR-', contactUniqueId::text)) as "sourcedId", 
        'active' as "status",
        contact.lastmodifieddate as "dateLastModified",
        null::text as "userMasterIdentifier",
        case when parent_emails.electronicmailaddress is null then '' else parent_emails.electronicmailaddress end as "username",
        json_build_array(json_build_object(
            'type', 'contactUniqueId',
            'identifier', contact.contactUniqueId
        )) as "userIds",
        'true' as "enabledUser",
        contact.firstname as "givenName",
        contact.lastsurname as "familyName",
        contact.middlename as "middleName",
        contact.preferredfirstname as "preferredFirstName",
        null::text as "preferredMiddleName",
        contact.preferredlastsurname as "preferredLastName",
        null::text as "pronouns",
        'parent' as "role",
        student_orgs_agg."parentRoles" AS "roles",
        null::text as "userProfiles",
        contact.contactUniqueId as "identifier",
        parent_emails.electronicmailaddress as "email",
        null::text as "sms",
        null::text as "phone",
        null::text as "agentSourceIds",
        null::json as "grades",
        null::text as "password",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'contacts',
                'naturalKey', json_build_object(
                    'contactUniqueId', contactUniqueId
                )
            )
        ) AS metadata
    from edfi.contact
        join edfi.studentcontactassociation
            on contact.contactusi = studentContactAssociation.contactusi
        join student
            on studentContactAssociation.studentusi = student.studentusi
        left join parent_emails
            on studentContactAssociation.contactusi = parent_emails.contactusi
        left join student_orgs_agg
            on student.studentusi = student_orgs_agg.studentusi
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p26p2
select * from formatted_users_student
union all 
select * from formatted_users_staff
union all 
select * from formatted_users_parents;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists users_sourcedid ON oneroster12.users ("sourcedId");
